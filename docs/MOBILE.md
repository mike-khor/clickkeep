# Mobile plan — iPhone and Apple Watch

This document is the design record for ClickKeep's native mobile story. The web
PWA (`apps/web`) is the source of truth for UI. Native shells exist for two
reasons only:

1. **Lower-latency audio + reliable haptics** on iOS (Mobile Safari blocks
   `navigator.vibrate` entirely; PWA audio latency is higher than native
   `AVAudioEngine`).
2. **Apple Watch on-wrist haptic clicks** — the killer feature for a drummer
   counting in a song while a guitarist's hands are on the strings.

This doc is the plan. Code lives in `apps/ios/` and `apps/watch/` (stubs only
right now — see those READMEs for bootstrap steps).

---

## Recommendations up front

| Decision | Choice | Confidence |
| --- | --- | --- |
| iPhone shell | **Capacitor 6+** wrapping `apps/web` | High |
| Apple Watch app | Native SwiftUI (no alternative — required) | High |
| Watch ↔ phone link | **WatchConnectivity** as the primary path; WebSocket-direct as a fallback we may add later | Medium-high |
| Haptic plugin (iOS) | `@capacitor/haptics` (`ImpactStyle.Medium` for ordinary beats, `ImpactStyle.Heavy` for downbeats) | High |
| Haptic API (Watch) | `WKInterfaceDevice.current().play(.click)` ordinary, `.start` for downbeats | Medium — needs on-wrist tuning |

The rest of this document defends those choices and gives Mike a step-by-step
testing path that costs **$0 today** and goes as far as a paid Developer
Program account allows when he's ready.

---

## 1. iPhone shell: Capacitor vs. Expo vs. native SwiftUI

### Recommendation: Capacitor 6+

We already have a fully working React + Vite PWA at `apps/web`. The click
engine (`packages/click-engine`), sync core (`packages/sync-core`), and session
client (`apps/web/src/lib/session-client.ts`) are platform-agnostic TypeScript.
Capacitor lets us load that exact bundle inside a `WKWebView` host and only
swap the **two** primitives that don't work well in Safari iOS:

- **Haptics** — replace `pulse()` in `packages/click-engine/src/haptic.ts`
  with a Capacitor-aware shim (see §3 below).
- **Audio latency** (optional, later) — if the WebAudio scheduler latency
  through `WKWebView` proves too high in practice, write a thin Capacitor
  plugin that exposes `AVAudioEngine` and have the scheduler emit beats
  through it. The scheduler's `onBeatScheduled` callback in
  `packages/click-engine/src/scheduler.ts` is already the right seam — it's
  a side-effect hook the click engine fires for every scheduled beat.

Everything else — WebSocket session client, clock-offset estimation, tempo
math, MIDI parsing, UI — runs unmodified.

### Why not Expo / React Native?

Expo would mean rewriting the UI in React Native primitives (no DOM, no
Tailwind class names, no `<audio>`/`<canvas>`). The web PWA is the project's
source of truth per `CLAUDE.md` — duplicating it in RN doubles maintenance
without buying us anything. Audio in RN goes through `expo-av` which has
**higher** latency than `WKWebView` + Web Audio, not lower. Expo wins when you
need native navigation and platform UI; we need neither.

### Why not native SwiftUI for the iPhone?

Same reason as Expo, more so. We'd be reimplementing the whole React app in
Swift. The benefit (best-possible audio latency on iOS) is real but small —
a well-tuned `WKWebView` + Web Audio is in the low-tens-of-milliseconds range,
which is below human perception for an isolated metronome click. The cost
(two UIs to maintain forever) is huge.

### One concrete risk to flag

Capacitor's `WKWebView` does **not** suspend Web Audio when the app
backgrounds — but the OS may suspend the entire app. We will need an
`AVAudioSession` configuration of category `.playback` so iOS keeps the audio
graph alive in the background. This is one line in a Capacitor config plugin
(`@capacitor-community/audio-session` or a 20-line custom plugin). Document
it in `apps/ios/README.md` when we bootstrap.

---

## 2. Apple Watch: separate SwiftUI app

There is no cross-platform watch story worth considering. The Watch app is a
small SwiftUI target that ships alongside the iPhone app in the same Xcode
project (`apps/ios/App/App.xcworkspace`). Capacitor doesn't touch it.

### How the Watch gets session state

Two viable paths:

**A. Via the phone (recommended).** The Watch app pairs with the iPhone via
`WatchConnectivity` (`WCSession`). The iPhone Capacitor app receives the live
`SessionState` over WebSocket, then forwards `{tempo, anchorServerTime,
clockOffsetMs}` to the Watch any time it changes. The Watch runs the same
beat-scheduling math (a Swift port of `serverTimeForBeat` from
`packages/sync-core/src/tempo.ts`) and fires `WKInterfaceDevice.play(...)` on
each beat using its local monotonic clock + the offset relayed from the phone.

**B. WebSocket from the Watch directly.** WatchOS 6+ supports `URLSession`
WebSocket. The Watch could talk to the Durable Object the same way the phone
does.

**Choose A.** Reasons:

- **Battery.** The Watch radio is power-hungry; piggybacking on the phone's
  already-open WebSocket is essentially free.
- **Pairing UX.** Users expect the Watch to follow the phone. If the phone
  changes session, the Watch should change with it automatically — option A
  gives you that for free.
- **Clock offset.** The phone's measured offset is already accurate. Re-doing
  it from the Watch doubles the protocol surface.
- **Sync-core invariant** (`CLAUDE.md`, rule #2): clock offset is measured per
  device. With WatchConnectivity we do the math once and ship the result.
  This honors the invariant without per-watch protocol work in the worker.

Keep option B in the BACKLOG as a fallback for "Watch without phone nearby"
mode (e.g. solo metronome on the Watch while the phone is in a bag). It is
not the v1 design.

### Watch architecture sketch

```
WatchKit Extension                 iOS app (Capacitor host)
+---------------------+            +-----------------------------+
| ContentView         |            | React PWA (apps/web bundle) |
|   @StateObject vm   | <-- WC --> |   SessionClient (WS)        |
|   - tempo segments  |            |   ClockEstimate             |
|   - clockOffsetMs   |            |   SessionState              |
| BeatScheduler       |            +-----------------------------+
|   .play(.click)     |
+---------------------+
```

Concrete Swift sketch (will live in `apps/watch/App/ContentView.swift`):

```swift
struct ContentView: View {
  @StateObject private var session = WatchSessionModel()  // owns WCSession + scheduler
  var body: some View {
    VStack {
      Text(session.bpmLabel).font(.title2)
      BeatDot(isOn: session.flash)
      Button(session.isPlaying ? "Pause" : "Play") { session.toggle() }
    }
  }
}
```

The scheduler inside `WatchSessionModel` runs a `DispatchSourceTimer` on a
25 ms cadence (mirroring `scheduler.ts`'s `scheduleIntervalMs`), computes
each upcoming beat from `tempo + anchorServerTime`, and calls
`WKInterfaceDevice.current().play(haptic)` at the right moment using
`DispatchQueue.main.asyncAfter(deadline: ...)`. WatchOS schedules haptics
sub-frame so this is accurate enough; we don't need a CoreAudio host on the
Watch.

---

## 3. Haptic plan

### Web today

`packages/click-engine/src/haptic.ts` exports `pulse()` and `accentPulse()`,
both calling `navigator.vibrate(...)`. On Mobile Safari this is a **no-op**
(WebKit doesn't implement the Vibration API). Android Chrome buzzes for
~30 ms ordinary / 60 ms accent.

### Plan: a thin runtime switch

Introduce a Capacitor-aware variant in a future PR (not in this scaffold —
the swap requires touching `packages/click-engine` which is Tier 2/3, and
this doc-only PR stays clean). The shape we'll land on:

```ts
// In a future tier-appropriate PR, behind a runtime check:
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

export function pulse(durationMs = 30): void {
  if (Capacitor.isNativePlatform()) {
    void Haptics.impact({ style: ImpactStyle.Medium });
    return;
  }
  navigator.vibrate?.(durationMs);
}

export function accentPulse(): void {
  if (Capacitor.isNativePlatform()) {
    void Haptics.impact({ style: ImpactStyle.Heavy });
    return;
  }
  navigator.vibrate?.(60);
}
```

### Intensity mapping

| Event | Web (Android) | iOS (Capacitor) | Watch (WKHapticType) |
| --- | --- | --- | --- |
| Ordinary beat (beat % 4 != 0) | `vibrate(30)` | `ImpactStyle.Medium` | `.click` |
| Downbeat (beat % 4 == 0) | `vibrate(60)` | `ImpactStyle.Heavy` | `.start` |
| Stop/end-of-song | — | `NotificationType.Success` | `.stop` |
| Failed action (tier-3 attempt etc.) | — | `NotificationType.Warning` | `.failure` |

`ImpactStyle.Heavy` on Taptic Engine produces a noticeably firmer thump than
`Medium` — perceptually similar to the audio click's downbeat accent. On the
Watch, `.start` and `.stop` are the closest equivalents to "this means
something more than a tick" — they're the haptics WatchOS uses for workout
boundaries, which is exactly the semantic we want.

### Latency note

`Haptics.impact` has ~10–20 ms latency on iPhone (Taptic Engine warm-up).
The scheduler already calls `onBeatScheduled` ~100 ms ahead of the audio
strike (`lookaheadSec = 0.1`). So firing the haptic from the `onBeatScheduled`
callback would land 80–90 ms **early**. The right pattern: schedule the
haptic with `DispatchQueue.main.asyncAfter` for the **audio strike time**,
not the scheduling moment. Same on the Watch with `asyncAfter`. This is a
test-on-device thing — we'll calibrate against the audio click and tune the
offset.

---

## 4. Testing — what Mike can do today, and what waits for the $99

### Today (free Apple ID, no Developer Program)

You can do all of this without paying Apple a cent:

1. **Install Xcode.** From the Mac App Store (~15 GB). Open it once and
   accept the license. In Xcode > Settings > Accounts, sign in with your
   personal Apple ID. This gives you a "Personal Team" code-signing identity
   that's free.
2. **Run the iOS app in the simulator.** Once we bootstrap Capacitor (see
   `apps/ios/README.md`):
   ```bash
   cd apps/ios
   npx cap open ios          # opens App.xcworkspace in Xcode
   ```
   In Xcode: click the run-target dropdown next to the Stop button (top
   center) → pick "iPhone 15 Pro" (or any simulator) → hit ⌘R. The
   simulator does **not** require a paid account.
3. **Run on your physical iPhone with a free Apple ID.** This works, with
   limits.
   1. Plug the iPhone into the Mac with a Lightning/USB-C cable.
   2. On the iPhone: Settings > General > VPN & Device Management > trust
      the Mac (the iPhone will ask).
   3. In Xcode: **Window > Devices and Simulators**. Your iPhone should
      appear in the left sidebar under "Devices". If it shows "Preparing
      device for development…" wait — first-time pairing takes a minute or
      two.
   4. Back in the main editor, select your iPhone from the run-target
      dropdown.
   5. In the **App** target (left sidebar in the project navigator) >
      **Signing & Capabilities** tab: set Team to your Personal Team
      (`Apple ID — Your Name`). Bundle ID needs to be unique — change to
      something like `com.your-name.clickkeep` to dodge collisions with
      anyone else who tried this.
   6. Hit ⌘R. Xcode will install the app and try to launch. The first time
      it'll fail with "Untrusted Developer." On the iPhone go to Settings >
      General > VPN & Device Management > tap your Apple ID > Trust. Hit
      ⌘R again.
   7. **Free-tier limitations:**
      - The app **expires after 7 days**. You have to re-install via Xcode.
      - Maximum 3 apps signed with a free Apple ID at a time.
      - **No push notifications, no Apple Pay, no HealthKit** — none of
        which we use.
      - **Apple Watch sideloading is restricted with a free account.** You
        can build and run a Watch app on a paired Watch in the simulator,
        but installing on a physical Watch reliably needs a paid account.
        (Xcode will sometimes let you, but it's flaky and Apple has
        tightened this in recent Xcode versions.) See "Watch pairing" below.
4. **Run the Watch app in the simulator.** Xcode bundles paired
   iPhone+Watch simulator pairs. In **Window > Devices and Simulators >
   Simulators** tab, find "iPhone 15 Pro" — it has a paired "Apple Watch
   Series 9 (45mm)" listed under it. Selecting the iPhone simulator and
   running the **Watch** scheme (top-left scheme picker, switch from "App"
   to "WatchApp") brings up both simulators. The Watch simulator can
   render UI fine, but **haptics don't fire in the simulator** — you
   only feel them on real hardware.
5. **Watch pairing for development.** To run the Watch app on a real Apple
   Watch:
   - The Watch must already be paired with your iPhone in the Apple Watch
     app on iOS.
   - Both devices must be on the same Wi-Fi.
   - In Xcode > Window > Devices and Simulators > Devices, you should see
     the Watch listed *underneath* the iPhone (indented). Xcode will say
     "Connect via network" — toggle that on for the iPhone, which lets
     Xcode push the Watch build over the air.
   - First build to a Watch takes ~5 minutes (it's slow — be patient).

### Gated until $99/year (Apple Developer Program)

Mike pays $99/yr at https://developer.apple.com/programs/ when ready. Then:

- **TestFlight.** Distribute up to 10,000 external testers without App
  Store review (just a quick "beta review"). Process:
  1. In Xcode: Product > Archive (must select "Any iOS Device" as the run
     target, not a simulator).
  2. The Organizer window opens automatically. Click "Distribute App" >
     "App Store Connect" > "Upload."
  3. Go to https://appstoreconnect.apple.com, find ClickKeep under My Apps,
     go to TestFlight tab. Add testers by email or share a public link.
  4. Testers install the **TestFlight** app from the App Store and tap the
     invite link.
  5. TestFlight builds expire after 90 days — push a new build before then.
- **Reliable Apple Watch sideloading** to physical Watches for testers.
- **App Store release** (separate from TestFlight, with full review).
- **Push notifications** — we don't need these (anonymous, no accounts).
- **Stable bundle IDs** — free-tier provisioning rotates; paid IDs are
  permanent.

### Things to verify on physical hardware before TestFlight

When you finally have a build on a real iPhone:

- [ ] Audio click fires within ~15 ms of the visual beat flash (compare to
      a second device running the web app).
- [ ] Audio keeps playing when the screen locks. (If not: `AVAudioSession`
      category needs adjusting — see §1.)
- [ ] Haptic fires on every beat and feels stronger on downbeats.
- [ ] Two iPhones in the same session stay in lock-step on the same
      Wi-Fi (visual flash within one frame of each other when held side by
      side).
- [ ] One iPhone + one Watch (paired) clicks together; the Watch haptic
      lands within ~30 ms of the phone's audio.

---

## 5. Out of scope for this document

- **Android.** Capacitor's Android target is the same approach (`npx cap
  add android`); we'll spec that in a follow-up. Wear OS is a separate
  Compose project mirroring the Watch design.
- **Native audio plugin.** Only if Web Audio in `WKWebView` proves too
  jittery on real hardware. The seam (scheduler's `onBeatScheduled`) is
  ready; we don't need to plan it now.
- **Background audio policy.** Documented as a risk; the bootstrap PR
  (Tier 2, in BACKLOG) configures `AVAudioSession`.
- **Live Activities / Dynamic Island.** Cute, not necessary for v1.

---

## File map

```
docs/MOBILE.md          this file
apps/ios/README.md      bootstrap checklist for Capacitor iOS
apps/watch/README.md    SwiftUI structure plan
```

Real code lands in tier-appropriate follow-up PRs tracked in `BACKLOG.md`
under "Later".
