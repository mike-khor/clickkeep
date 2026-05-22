# BACKLOG

The PM agent (`.claude/agents/pm.md`) reads this file to decide what to dispatch next. Keep entries one-line where possible. Move items between sections as priority shifts. Append rationale in parentheses only when it isn't obvious from the title.

Format:
```
- [tier:N] [size:S|M|L] Title — optional one-line note
```
Tier matches the auto-merge tier the work is expected to touch (see CLAUDE.md). Size is a rough estimate (S < 1h, M < 4h, L < 1 day).

## Now (active sprint)

- [tier:2] [size:S] Per-member mute/solo of audio/visual/haptic (subsumes visual-only and haptic-only modes)
- [tier:2] [size:M] PWA manifest + service worker for offline solo mode
- [tier:3] [size:M] MIDI tempo map import (parse `@tonejs/midi`, render timeline, schedule changes) — dep add bumps to Tier 3

## Next (after Now ships)

- [tier:2] [size:L] Concert Mode: setlist of songs, owner next/prev/play/pause, members follow
- [tier:2] [size:M] Export/import setlist JSON (anonymous persistence)
- [tier:2] [size:S] Hash-fragment URL with embedded setlist (bookmarkable session config)
- [tier:3] [size:M] Feedback widget → GitHub issue → tier-gated PR pipeline
- [tier:3] [size:L] Deploy: Cloudflare Pages for web, Workers for session, custom domain

## Later (parking lot)

- Capacitor wrap for iOS + Android (native audio for lower latency, native haptics)
- Apple Watch app (SwiftUI, WatchConnectivity bridge to phone app)
- Wear OS app (Compose)
- Tuner module (microphone pitch detection, A=432/440/442 reference)
- Pitch pipe (drone tones, instrument-aware presets)
- Tune time map (auto-extract tempo from audio recording, align with metronome)
- Ableton Live sync (Link protocol, requires native; investigate WASM Link)
- Accessibility audit + screen reader pass
- i18n
- Recording / loop click for practice

## Done

- 2026-05-21 — [tier:3] [size:M] Monorepo + web app + worker scaffold compiling end-to-end (#1)
- 2026-05-21 — [tier:2] [size:M] Solo metronome: BPM slider, play/pause, beat flash, audible click (#1–#5)
- 2026-05-21 — [tier:2] [size:S] Tap tempo with rolling 4-tap average and 2s auto-reset (TapButton.tsx)
- 2026-05-21 — [tier:3] [size:M] Durable Object: join-code generation, WebSocket fan-out, clock-offset endpoint (workers/session)
- 2026-05-21 — [tier:2] [size:M] Group sync v1: owner sets BPM, members receive and align (#6–#8)
- 2026-05-21 — [tier:1] [size:S] Dark/light mode toggle in header (ThemeToggle.tsx)
- 2026-05-21 — Visual-only and Haptic-only mode entries folded into "Per-member mute/solo"
