# BACKLOG

The PM agent (`.claude/agents/pm.md`) reads this file to decide what to dispatch next. Keep entries one-line where possible. Move items between sections as priority shifts. Append rationale in parentheses only when it isn't obvious from the title.

Format:
```
- [tier:N] [size:S|M|L] Title — optional one-line note
```
Tier matches the auto-merge tier the work is expected to touch (see CLAUDE.md). Size is a rough estimate (S < 1h, M < 4h, L < 1 day).

## Now (active sprint)

- [tier:3] [size:M] Get monorepo + web app + worker scaffold compiling end-to-end
- [tier:2] [size:M] Solo metronome: BPM slider, play/pause, beat flash, audible click
- [tier:2] [size:S] Tap tempo with rolling 4-tap average and 2s auto-reset
- [tier:3] [size:M] Durable Object: join-code generation, WebSocket fan-out, clock-offset endpoint
- [tier:2] [size:M] Group sync v1: owner sets BPM, members receive and align to within 10ms

## Next (after Now ships)

- [tier:2] [size:M] MIDI tempo map import (parse `@tonejs/midi`, render timeline, schedule changes)
- [tier:2] [size:L] Concert Mode: setlist of songs, owner next/prev/play/pause, members follow
- [tier:2] [size:S] Visual-only mode (silence the click, big flashing beat indicator)
- [tier:2] [size:S] Haptic-only mode (silent + visual off, vibrate on each beat)
- [tier:2] [size:S] Per-member mute/solo of audio/visual/haptic
- [tier:1] [size:S] Dark/light mode toggle in header (system preference by default)
- [tier:2] [size:M] Export/import setlist JSON (anonymous persistence)
- [tier:2] [size:S] Hash-fragment URL with embedded setlist (bookmarkable session config)
- [tier:3] [size:M] Feedback widget → GitHub issue → tier-gated PR pipeline
- [tier:3] [size:L] Deploy: Cloudflare Pages for web, Workers for session, custom domain
- [tier:2] [size:M] PWA manifest + service worker for offline solo mode

## Later (parking lot)

- [tier:2] [size:M] Bootstrap Capacitor iOS wrap — run `npx cap init` / `npx cap add ios` per `apps/ios/README.md`; commit generated `capacitor.config.ts` and `Podfile.lock`, gitignore the Xcode project (plan: `docs/MOBILE.md`)
- [tier:2] [size:M] Haptic mode parity (Capacitor Haptics) — swap `packages/click-engine/src/haptic.ts` to dispatch `@capacitor/haptics` on native, keep `navigator.vibrate` fallback for web (intensity table in `docs/MOBILE.md` §3)
- [tier:3] [size:L] Bootstrap Apple Watch SwiftUI app — add `ClickKeepWatch` target inside the iOS workspace, port `BeatScheduler` + `SyncMath`, relay state via `WatchConnectivity` (plan: `apps/watch/README.md`)
- [tier:3] [size:M] TestFlight CI/CD for iOS builds — GitHub Actions workflow on a self-hosted macOS runner (or `macos-14` hosted) that archives the iOS app and uploads to App Store Connect via `xcrun altool` / Fastlane; gated on the paid Developer Program account
- Capacitor wrap for Android (native audio for lower latency, native haptics)
- Apple Watch solo mode — WebSocket-direct from the Watch when no paired iPhone is nearby
- Wear OS app (Compose)
- Tuner module (microphone pitch detection, A=432/440/442 reference)
- Pitch pipe (drone tones, instrument-aware presets)
- Tune time map (auto-extract tempo from audio recording, align with metronome)
- Ableton Live sync (Link protocol, requires native; investigate WASM Link)
- Accessibility audit + screen reader pass
- i18n
- Recording / loop click for practice

## Done

(Move completed items here with a date. Trim when this gets long.)
