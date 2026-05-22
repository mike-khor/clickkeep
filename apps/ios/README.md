# apps/ios — Capacitor iOS shell (stub)

This directory is intentionally a stub. The full plan lives in
[`docs/MOBILE.md`](../../docs/MOBILE.md). When Mike is ready to bootstrap
Capacitor, run the commands in **Bootstrap** below. **Do not run them
prematurely** — `npx cap add ios` writes a large generated Xcode project and
`Pods/` directory into this folder, which is a Tier 2/3 change (it adds
dependencies + native config). It should land in its own PR, not bundled
with anything else.

---

## Preconditions checklist

Tick each before running the bootstrap commands.

- [ ] **macOS 14 (Sonoma) or newer.** Xcode 15+ requires Sonoma.
- [ ] **Xcode 15+ installed** from the Mac App Store. Open it once,
      accept the license, install the iOS platform support pack when
      prompted (~7 GB extra).
- [ ] **Xcode command-line tools:** `xcode-select --install` (a no-op if
      already installed).
- [ ] **CocoaPods 1.15+:** `sudo gem install cocoapods` (or
      `brew install cocoapods`). Verify with `pod --version`.
- [ ] **Apple ID signed in to Xcode** at Xcode > Settings > Accounts.
      Free Apple ID is fine to start; see `docs/MOBILE.md` §4 for what's
      gated until you pay the $99/yr Developer Program fee.
- [ ] **Node 20+ and pnpm 9+** (you already have these — see
      `docs/DEVELOPMENT.md`).
- [ ] **`apps/web` builds:** `pnpm --filter @clickkeep/web build` produces
      a `dist/` folder. Capacitor will copy this into the iOS app bundle.

---

## Bootstrap (when ready — not yet)

Run from the **repo root**, not from `apps/ios/`:

```bash
# 1. Install Capacitor in the web workspace so the bundled JS can import
#    @capacitor/core and @capacitor/haptics at runtime.
pnpm --filter @clickkeep/web add @capacitor/core @capacitor/ios @capacitor/haptics

# 2. Initialize Capacitor. Use these exact values when it prompts you:
#      App name:        ClickKeep
#      App ID (bundle): com.clickkeep.app    (or com.<your-name>.clickkeep for free-tier dev)
#      Web dir:         ../../apps/web/dist
#    Run this from apps/ios/ so the generated capacitor.config.ts lives here.
cd apps/ios
npx cap init "ClickKeep" "com.clickkeep.app" --web-dir="../../apps/web/dist"

# 3. Build the web bundle (Capacitor copies from web-dir).
cd ../..
pnpm --filter @clickkeep/web build

# 4. Add the iOS platform. This generates apps/ios/ios/App/App.xcworkspace
#    plus CocoaPods setup. Takes ~2 minutes the first time.
cd apps/ios
npx cap add ios

# 5. Sync the web build into the native project. Re-run this every time
#    the web bundle changes.
npx cap sync ios

# 6. Open Xcode.
npx cap open ios
```

In Xcode after step 6, follow `docs/MOBILE.md` §4 to run on the simulator
or a physical device.

---

## After bootstrap: things the bootstrap PR must also do

The PR that runs the commands above must also:

1. **Add `apps/ios/ios/` and `apps/ios/node_modules/` to `.gitignore`.**
   Generated Xcode project + Pods are large; we don't commit them. The
   `capacitor.config.ts` and `package.json` in `apps/ios/` *are* committed.
2. **Add a `Podfile.lock` checked in** (CocoaPods convention — pins
   transitive native deps).
3. **Configure `AVAudioSession` category to `.playback`** so audio
   survives screen lock. Easiest via a small custom Capacitor plugin
   (~30 lines of Swift in `ios/App/App/AudioSessionPlugin.swift`) or by
   adopting `@capacitor-community/audio-session`. See `docs/MOBILE.md` §1.
4. **Swap `packages/click-engine/src/haptic.ts`** to the Capacitor-aware
   shim documented in `docs/MOBILE.md` §3. This is a Tier 2 edit (it
   modifies `packages/click-engine/` but **not** `scheduler.ts`).
5. **Add a Capacitor-specific dev script** in this directory's
   `package.json`:
   ```json
   "scripts": {
     "sync": "pnpm --filter @clickkeep/web build && cap sync ios",
     "open": "cap open ios"
   }
   ```

---

## What we will NOT do here

- No `cap add android` in this directory — Android is a separate followup
  tracked in `BACKLOG.md`.
- No native plugin code beyond the minimum to set the audio session. If
  WebAudio latency proves bad on real hardware, **then** we add an
  `AVAudioEngine` plugin in a dedicated PR.
- No app icon / splash screen design here. Tier 1 follow-up.

---

## Related files

- [`docs/MOBILE.md`](../../docs/MOBILE.md) — full design rationale
- [`apps/watch/README.md`](../watch/README.md) — Apple Watch plan
- [`packages/click-engine/src/haptic.ts`](../../packages/click-engine/src/haptic.ts) — the helper that gets swapped for the native version
