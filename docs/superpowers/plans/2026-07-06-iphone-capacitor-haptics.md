# iPhone Capacitor Haptics — Implementation Plan

**Goal:** Wrap the ClickKeep PWA in a Capacitor iOS shell so real Taptic-Engine haptics fire on every beat when running on a physical iPhone. Solo-mode only.

**Architecture:** New `apps/mobile/` workspace holds the Capacitor project. In dev, the Capacitor shell loads the web app over LAN from the running Vite dev server (`server.url`). At runtime, `apps/web` checks for `window.Capacitor.Plugins.Haptics` and, when found, installs a native-haptic implementation into `@clickkeep/click-engine`'s adapter slot. Web builds and browser use are unaffected — the adapter falls back to `navigator.vibrate` as today.

**Tech Stack:** Capacitor 7 (`@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`, `@capacitor/haptics`), Xcode 15+, iOS 16+, existing Vite + React web app.

## Global Constraints

- No `@capacitor/*` package in `apps/web/package.json` — deps live only in `apps/mobile/package.json`. Web-app source references Capacitor via `window.Capacitor` runtime globals only.
- `packages/click-engine/src/scheduler.ts` is Tier 3 — do not touch. All click-engine changes stay in `haptic.ts` and its test.
- iOS Bundle ID: `app.clickkeep.mobile`. App display name: `ClickKeep`.
- Xcode signing uses Free Personal Team (7-day certs are OK for MVP). Document this.
- Capacitor 7 is the pinned major. Do not silently upgrade.

---

## Task 1: Add injectable haptic adapter to click-engine

**Files:**
- Modify: `packages/click-engine/src/haptic.ts`
- Create: `packages/click-engine/src/haptic.test.ts`
- Modify: `packages/click-engine/src/index.ts` (re-export `setHapticImpl`, `HapticImpl`)

**Interfaces:**
- Consumes: nothing new
- Produces:
  - `type HapticImpl = (durationMs: number) => void`
  - `setHapticImpl(impl: HapticImpl | null): void` — pass `null` to restore default
  - `pulse(durationMs?: number): void` — unchanged signature, now delegates to installed impl if set, otherwise `navigator.vibrate`
  - `accentPulse(): void` — unchanged

- [ ] **Step 1: Write failing test for adapter installation**

Create `packages/click-engine/src/haptic.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pulse, setHapticImpl } from './haptic.js';

describe('haptic adapter', () => {
  afterEach(() => setHapticImpl(null));

  it('calls installed impl instead of navigator.vibrate', () => {
    const impl = vi.fn();
    setHapticImpl(impl);
    pulse(42);
    expect(impl).toHaveBeenCalledWith(42);
  });

  it('falls back to navigator.vibrate when no impl installed', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    pulse(30);
    expect(vibrate).toHaveBeenCalledWith(30);
  });

  it('setHapticImpl(null) restores fallback', () => {
    const impl = vi.fn();
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    setHapticImpl(impl);
    setHapticImpl(null);
    pulse(30);
    expect(impl).not.toHaveBeenCalled();
    expect(vibrate).toHaveBeenCalledWith(30);
  });
});
```

- [ ] **Step 2: Run the test — expect fail**

Run: `pnpm --filter @clickkeep/click-engine test`
Expected: FAIL — `setHapticImpl` is not exported.

- [ ] **Step 3: Rewrite haptic.ts with adapter**

Replace `packages/click-engine/src/haptic.ts` with:

```typescript
/**
 * Fire a short haptic pulse. Web browsers use navigator.vibrate (Safari iOS
 * blocks this — the Capacitor iOS shell installs a native Taptic-Engine impl
 * via setHapticImpl at boot). No-op on platforms with neither.
 */

export type HapticImpl = (durationMs: number) => void;

let installed: HapticImpl | null = null;

/** Install a platform-specific haptic implementation. Pass null to restore the default. */
export function setHapticImpl(impl: HapticImpl | null): void {
  installed = impl;
}

export function pulse(durationMs = 30): void {
  if (installed !== null) {
    installed(durationMs);
    return;
  }
  if (typeof navigator === 'undefined') return;
  const nav = navigator as { vibrate?: (pattern: number | number[]) => boolean };
  if (typeof nav.vibrate === 'function') {
    nav.vibrate(durationMs);
  }
}

/** Stronger accent pulse for downbeats. */
export function accentPulse(): void {
  pulse(60);
}
```

- [ ] **Step 4: Re-export from index.ts**

Modify `packages/click-engine/src/index.ts` — add to existing exports:

```typescript
export { setHapticImpl, pulse, accentPulse, type HapticImpl } from './haptic.js';
```

(If `pulse`/`accentPulse` are already exported via `export *`, verify no duplicate.)

- [ ] **Step 5: Run the test — expect pass**

Run: `pnpm --filter @clickkeep/click-engine test`
Expected: all pass, including the 3 new adapter tests.

- [ ] **Step 6: Typecheck the whole workspace**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/click-engine/src/haptic.ts packages/click-engine/src/haptic.test.ts packages/click-engine/src/index.ts
git commit -m "feat(click-engine): injectable haptic adapter for platform overrides"
```

---

## Task 2: Bind Vite dev server to LAN

**Files:**
- Modify: `apps/web/vite.config.ts`

**Interfaces:**
- Consumes: nothing
- Produces: dev server accepts connections from any host on port 5173

- [ ] **Step 1: Add `host: true` to server + preview**

Modify `apps/web/vite.config.ts`:

```typescript
/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 5173,
  },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
  },
});
```

- [ ] **Step 2: Restart the dev server and confirm LAN URL is printed**

Run: `pnpm dev` (from repo root; kill any running instance first)
Expected: startup log shows both `Local: http://localhost:5173/` and `Network: http://<your-ip>:5173/`. Note the network IP.

- [ ] **Step 3: Curl from another device or from the Mac itself using the LAN IP**

Run: `curl -sSf http://<your-ip>:5173/ | head -5`
Expected: HTML with `<!doctype html>` and no connection refused.

- [ ] **Step 4: Commit**

```bash
git add apps/web/vite.config.ts
git commit -m "chore(web): bind Vite dev server to LAN for device testing"
```

---

## Task 3: Scaffold apps/mobile Capacitor project

**Files:**
- Create: `apps/mobile/package.json`
- Create: `apps/mobile/capacitor.config.ts`
- Create: `apps/mobile/.gitignore`
- Create: `apps/mobile/README.md`
- Create: `apps/mobile/ios/` (generated by `cap add ios`)
- Modify: `pnpm-workspace.yaml` — verify `apps/*` is included; if not, add.

**Interfaces:**
- Consumes: a running Vite dev server on `http://<mac-ip>:5173` (from Task 2)
- Produces: an Xcode project at `apps/mobile/ios/App/App.xcworkspace` that launches ClickKeep on a connected iPhone

- [ ] **Step 1: Verify Xcode is installed and command-line tools are set**

Run: `xcode-select -p && xcodebuild -version`
Expected: prints a Developer path and `Xcode 15.x` or newer. If missing, install Xcode from App Store and run `sudo xcode-select --switch /Applications/Xcode.app` first.

- [ ] **Step 2: Verify pnpm workspace includes `apps/*`**

Run: `cat pnpm-workspace.yaml`
Expected: `packages:` list containing `apps/*` (or `apps/web` explicitly plus a wildcard). If only `apps/web` is listed, replace with `apps/*`.

- [ ] **Step 3: Create apps/mobile package.json**

Create `apps/mobile/package.json`:

```json
{
  "name": "@clickkeep/mobile",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "cap": "cap",
    "ios:open": "cap open ios",
    "ios:sync": "cap sync ios",
    "ios:run": "cap run ios"
  },
  "dependencies": {
    "@capacitor/core": "^7.0.0",
    "@capacitor/ios": "^7.0.0",
    "@capacitor/haptics": "^7.0.0"
  },
  "devDependencies": {
    "@capacitor/cli": "^7.0.0"
  }
}
```

- [ ] **Step 4: Determine your Mac's LAN IP**

Run: `ipconfig getifaddr en0 || ipconfig getifaddr en1`
Expected: an address like `192.168.1.42`. Record it as `<MAC_IP>` for the next step.

- [ ] **Step 5: Create capacitor.config.ts pointing at the LAN Vite server**

Create `apps/mobile/capacitor.config.ts` (substitute `<MAC_IP>` with the value from Step 4):

```typescript
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.clickkeep.mobile',
  appName: 'ClickKeep',
  webDir: 'www',
  server: {
    // Dev mode: load from Vite on the Mac over LAN. iPhone must be on the
    // same Wi-Fi. For production, delete `server` and populate `www/` with
    // `apps/web`'s build output.
    url: 'http://<MAC_IP>:5173',
    cleartext: true,
  },
};

export default config;
```

- [ ] **Step 6: Create apps/mobile/.gitignore**

Create `apps/mobile/.gitignore`:

```
node_modules/
www/
ios/App/App/public/
ios/App/Pods/
ios/.gitignore.local
DerivedData/
*.xcuserdata/
```

- [ ] **Step 7: Create a stub `www/` so `cap add ios` doesn't fail**

Run:

```bash
mkdir -p apps/mobile/www
echo '<!doctype html><title>stub</title>' > apps/mobile/www/index.html
```

Expected: `apps/mobile/www/index.html` exists. Capacitor requires `webDir` to exist at add-ios time even though `server.url` overrides it at runtime.

- [ ] **Step 8: Install deps**

Run: `pnpm install`
Expected: `@capacitor/*` packages installed under the workspace root's `node_modules`.

- [ ] **Step 9: Add the iOS platform**

Run:

```bash
cd apps/mobile
pnpm cap add ios
cd -
```

Expected: `apps/mobile/ios/` directory created containing an Xcode workspace at `ios/App/App.xcworkspace`. This step also runs `pod install` — if CocoaPods is not installed, install it: `sudo gem install cocoapods` then re-run.

- [ ] **Step 10: Register `@capacitor/haptics` with the shell**

Run: `cd apps/mobile && pnpm cap sync ios && cd -`
Expected: sync completes without errors and lists `@capacitor/haptics` as an installed plugin.

- [ ] **Step 11: Create apps/mobile/README.md**

Create `apps/mobile/README.md`:

```markdown
# @clickkeep/mobile

Capacitor iOS shell around the ClickKeep PWA. Wraps `apps/web` in a native
container so iOS haptics can fire from the Taptic Engine (Safari blocks
`navigator.vibrate`).

## Dev workflow

1. Start the web app with `pnpm dev` from the repo root — Vite binds to
   the LAN on port 5173.
2. Confirm `capacitor.config.ts`'s `server.url` matches your Mac's LAN IP.
   Update it and re-run `pnpm cap sync ios` if your IP changed.
3. Open the Xcode workspace: `pnpm ios:open` (from `apps/mobile/`).
4. In Xcode, select your iPhone as the run destination, sign with your
   personal team under Signing & Capabilities, then hit Run.
5. Trust the developer profile on the iPhone under Settings → General →
   VPN & Device Management the first time.

## Production build (later)

Delete the `server` block from `capacitor.config.ts`, run
`pnpm --filter @clickkeep/web build`, copy the output into
`apps/mobile/www/`, then `pnpm cap sync ios`.
```

- [ ] **Step 12: Commit**

```bash
git add apps/mobile pnpm-workspace.yaml
git commit -m "feat(mobile): scaffold Capacitor iOS shell for on-device haptic testing"
```

Note the `apps/mobile/ios/` directory is committed. If your team later wants to keep native platforms out of git, split that into a follow-up.

---

## Task 4: Install Capacitor haptic impl at web-app boot

**Files:**
- Create: `apps/web/src/lib/platform-haptic.ts`
- Modify: `apps/web/src/main.tsx`

**Interfaces:**
- Consumes: `setHapticImpl` from `@clickkeep/click-engine` (Task 1)
- Produces: `installPlatformHaptic(): void` — call at boot; no-op in ordinary browsers, installs a Taptic-Engine impl when running inside the Capacitor iOS shell

- [ ] **Step 1: Create the platform-haptic module**

Create `apps/web/src/lib/platform-haptic.ts`:

```typescript
import { setHapticImpl } from '@clickkeep/click-engine';

interface CapacitorHapticsPlugin {
  impact: (opts: { style: 'HEAVY' | 'MEDIUM' | 'LIGHT' }) => Promise<void>;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: { Haptics?: CapacitorHapticsPlugin };
}

/**
 * If we're running inside the Capacitor iOS shell, swap the click-engine's
 * default `navigator.vibrate` haptic (which Safari iOS blocks) for the native
 * Taptic Engine via @capacitor/haptics. In an ordinary browser this is a no-op
 * and click-engine keeps its default.
 */
export function installPlatformHaptic(): void {
  const cap = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (cap === undefined) return;
  if (typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return;
  const haptics = cap.Plugins?.Haptics;
  if (haptics === undefined) return;
  setHapticImpl((durationMs) => {
    // Web pulse durations are 20 ms (normal) / 60 ms (accent). The Taptic
    // Engine doesn't take a duration — it takes a discrete impact style.
    // Map the two known durations to LIGHT / HEAVY. Anything unexpected
    // falls back to MEDIUM so we still feel *something*.
    const style = durationMs >= 60 ? 'HEAVY' : durationMs <= 20 ? 'LIGHT' : 'MEDIUM';
    void haptics.impact({ style });
  });
}
```

- [ ] **Step 2: Call it at boot**

Modify `apps/web/src/main.tsx` — read the current file first:

Run: `cat apps/web/src/main.tsx`

Then add an import and a call so the file looks like (existing imports preserved):

```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { installPlatformHaptic } from './lib/platform-haptic.js';
import './index.css';

installPlatformHaptic();

const rootEl = document.getElementById('root');
if (rootEl !== null) {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
```

If the current `main.tsx` differs, keep its existing structure and only add the `installPlatformHaptic` import and the call (before render).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @clickkeep/web typecheck`
Expected: clean. If TypeScript complains about the `Capacitor` global, that's expected — the module casts through `globalThis` explicitly and never depends on `@types/capacitor__core`.

- [ ] **Step 4: Sanity-test in the browser**

Run: `pnpm dev`
Open `http://localhost:5173` in Chrome. Open DevTools → Console. Play the metronome. Expected: no errors. `installPlatformHaptic()` should return early because `window.Capacitor === undefined` in a regular browser.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/platform-haptic.ts apps/web/src/main.tsx
git commit -m "feat(web): install native haptic impl at boot when running under Capacitor"
```

---

## Task 5: Run on a physical iPhone and confirm haptics

**Files:** none — this task is fully manual.

**Interfaces:** Tasks 1–4 must be complete.

- [ ] **Step 1: Confirm Vite is running and reachable**

From the repo root: `pnpm dev` (leave it running).
From another terminal on the Mac: `curl -sSf http://<MAC_IP>:5173/ | head -3`
Expected: `<!doctype html>` output. If not, check macOS Firewall (System Settings → Network → Firewall) and allow `node` inbound.

- [ ] **Step 2: Connect the iPhone to the Mac via USB**

Plug in. On the iPhone, tap "Trust This Computer" if prompted. Confirm the phone is on the same Wi-Fi network as the Mac.

- [ ] **Step 3: Open the workspace in Xcode**

Run: `cd apps/mobile && pnpm ios:open`
Expected: Xcode opens `App.xcworkspace`.

- [ ] **Step 4: Configure signing**

In Xcode, select the `App` target → **Signing & Capabilities** → check **Automatically manage signing** → set **Team** to your personal Apple ID. If your Apple ID isn't listed, add it via Xcode → Settings → Accounts. Free personal-team certs expire after 7 days; you'll re-sign then.

- [ ] **Step 5: Select your iPhone as the run destination**

In Xcode's toolbar, click the destination selector next to the scheme → pick your iPhone by name.

- [ ] **Step 6: Build and run**

Click Run (▶). First-launch failure with "Untrusted Developer" is expected — on the iPhone, open Settings → General → VPN & Device Management → your Apple ID → Trust. Then hit Run again in Xcode.

Expected: ClickKeep launches on the iPhone. The screen shows the standard metronome UI, loaded from your Mac's Vite server.

- [ ] **Step 7: Tap Play**

Expected: audio Clicks fire, visual dots flash, AND you feel a Taptic-Engine bump on every beat, with a stronger bump on the downbeat.

- [ ] **Step 8: Sanity-check the negative path**

Toggle the haptic output button OFF in the app. Expected: audio and visual continue, but no more taptic pulses.
Toggle back ON. Expected: pulses resume.

- [ ] **Step 9: (Optional) Sanity-check the accent map**

Set beats per bar to 4. Cycle beat 1 through the accent dot to `accent` (already default), leave beats 2/3/4 as `normal`. Play. Expected: downbeat gets the stronger HEAVY impact; others get LIGHT.

- [ ] **Step 10: File any bugs**

If haptics don't fire, don't feel right, or the app freezes, file GitHub issues with reproduction steps. Suggested labels: `platform:ios`, `haptic`.

---

## Self-review

**Spec coverage:** Adapter (Task 1), LAN (Task 2), Capacitor project (Task 3), boot wiring (Task 4), device verification (Task 5). Solo-mode-only scope is stated in Global Constraints. Group-mode from device is explicitly deferred.

**Placeholder scan:** `<MAC_IP>` in Task 3 Step 5 is a live substitution the operator performs in Step 4 — not a TBD. All code steps show complete code.

**Type consistency:** `HapticImpl` in Task 1 matches its use in Task 4's `setHapticImpl((durationMs) => …)`. `installPlatformHaptic` signature returns void in both definition and call site.
