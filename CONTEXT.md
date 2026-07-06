# ClickKeep — ubiquitous language

This is the shared glossary. Every term here has a single canonical meaning across UI copy, code, docs, and PR discussion. If a word you need isn't here, either use one that is or open a PR that adds it. Implementation details live in `docs/` and `CLAUDE.md`, not here.

Related files:
- Architecture invariants and stack: `CLAUDE.md`
- Wire protocol reference: `docs/PROTOCOL.md`
- Dev workflow: `docs/DEVELOPMENT.md`
- Prioritized work: `BACKLOG.md`

---

## Modes

**Solo mode** — one device, no network. The metronome runs entirely from local state; no Session exists. `SessionRole = 'solo'`.

**Group mode** — one Owner and zero-or-more Members connected to the same Session. Every device clicks in lock-step.

**Concert mode** — a Group-mode Session where the Owner pre-loads a Setlist and advances Songs while Members follow. Not yet shipped; see `BACKLOG.md`.

---

## Identity and access

**Session** — one live rehearsal room, backed by exactly one Cloudflare Durable Object. Distinct from the browser's `sessionStorage`; when you mean the browser API, say "sessionStorage", never "session".

**Session ID** — the server-side UUID of a Session. Users never see this; it's what the Worker uses to route a Join Code to its Durable Object.

**Join Code** — the 4-character code the Owner shares with Members (e.g. `3KR9`). Drawn from a 31-symbol alphabet with no `I/L/O/0/1` (visually unambiguous). One code → one Session ID via KV. TTL 24h, renewed on activity.

**Owner Secret** — a UUID minted at Session creation. Whoever holds it can send state-changing messages (`set-state`, `play`, `pause`, `stop`). Kept in `sessionStorage` scoped to the Join Code, never in the URL.

**Owner Credential** — the `{sessionId, secret}` bundle stored client-side. The `sessionId` guards against a recycled Join Code silently promoting a stale secret.

**Member** — any connected client. **Owner** — the one Member who has presented the Owner Secret. **SessionRole** = `solo | owner | member` is purely UX (disables controls for non-owners); the Durable Object is the real authority.

---

## Timing model

**Server time** — `Date.now()` on the Durable Object's clock, in ms since epoch. **All shared instants on the wire are server time.** No client time ever crosses the wire.

**Client time** — `Date.now()` on the local device. Skewed from server time by an unknown offset.

**Clock offset** — how many ms to add to client time to get server time. Measured via NTP-style ping bursts and re-estimated every ~30 s.

**Clock estimate** — `{offsetMs, rttMs}`. `rttMs` is a confidence indicator; the estimate with the smallest RTT wins.

**Anchor** — the server-time instant at which beat 0 fires. Every device schedules audio against this same instant, translated through its own Clock Offset. On the wire: `SessionState.playback.anchorServerTime` (in `playing` state). In the client store: `sessionAnchorMs`. Same concept, historical naming split.

**Lookahead** — the ~100 ms window into the future within which the scheduler queues audio events with the AudioContext. Not a wire concept.

---

## Rhythm

**Beat** — one integer index in a Song, starting at 0. Beat 0 is the first Downbeat of the Song.

**BPM** — beats per minute. Range 30–300 (clamped everywhere). Floats are allowed (e.g. tap-tempo may produce 118.5).

**Beats per bar** — the numerator of the time signature within a Tempo Segment. Range 1–12.

**Downbeat** — beat 0 of a bar. Downbeats naturally receive an Accent unless the Accent Pattern overrides them.

**Tempo Segment** — one constant-BPM run: `{startAt, bpm, beatsPerBar}` where `startAt` is server time. A Song's tempo is an ordered list of Tempo Segments; segment boundaries reset the bar (a new segment's first beat is a Downbeat).

**Tempo Map** — an ordered list of tempo changes. **Careful — two incompatible shapes share this name:**
- **Wire Tempo Map** = `TempoSegment[]` (server-time absolute). This is `SongState.tempo` — the canonical form used by the scheduler.
- **MIDI Tempo Map** = `TempoChange[] = {timeSec, bpm}[]` (song-relative seconds). Produced by MIDI import; converted into a Wire Tempo Map when Play is pressed.

When ambiguous, say "wire tempo map" or "MIDI tempo map". Never just "tempo map".

**Beat State** — one of `accent | normal | mute`. Drives voice loudness and can suppress audio entirely (visual + haptic still fire on `mute`).

**Accent Pattern** — a `BeatState[]` of length `beatsPerBar` describing per-beat behavior within a bar. Index 0 is the Downbeat. Optional on the wire; absent means "accent on downbeat, normal elsewhere". Owner edits are broadcast to all Members.

---

## Song and playback

**Song** — one titled unit of music: `{id, title, tempo, accentPattern?}`. A solo user has one implicit Untitled Song; a Setlist can have many.

**Setlist** — ordered list of Songs. In Concert Mode the Owner advances through the Setlist. Today's UI always has exactly one Song.

**Playback state** — the Session's current phase:
- `stopped` — no Song playing.
- `playing` — Song `songId` is running against Anchor `anchorServerTime`.
- `paused` — Song `songId` is halted at `pausedAtBeat`.

**Play / Pause / Stop / Next / Prev** — the five Owner-only commands. Members' local buttons are disabled to prevent accidental desync.

---

## Output channels

Every Beat can fire on three independent channels. Each is a per-device toggle; toggling one never affects other devices.

**Click** (audio) — a short synthesized sound at the beat's audio time. Rendered by a **Voice**.

**Visual flash** — a UI pulse on the BeatIndicator. Fires even on `mute` beats.

**Haptic** — a `navigator.vibrate` pulse on supporting devices. Fires even on `mute` beats.

**Voice** — a pure function `(audioCtx, atTime, state) => void` that wires a one-shot Web Audio graph for one Click. Voices own their envelope; the scheduler doesn't know or care whether a Voice is pitched or noise.

**Tone Profile** — the user-facing id for a Voice: `pitched | pitched-alt | woodblock | snap | hi-hat`. Local-only per Member (no wire propagation).

---

## Wire protocol shorthand

Canonical shapes live in `packages/sync-core/src/types.ts`. High-level:

- **Client → Server:** `hello | ping | claim-owner | set-state | play | pause | stop | next-song | prev-song`.
- **Server → Client:** `welcome | pong | state | member-count | error`.
- **SessionState** — the whole picture of a Session at a version. `version` is monotonic; every state change bumps it. Fanned out on every change.

---

## Anti-terms — do not use

- **"User account"** / **"login"** / **"sign up"** — ClickKeep is anonymous-by-default. There are no accounts. Say **Owner** or **Member**.
- **"Room"** — say **Session**.
- **"Room code" / "PIN"** — say **Join Code**.
- **"Tick" / "pulse"** on the wire — the server never sends per-beat traffic. Say **Beat** for the concept and **Click** for the audio event.
- **"Sync message" / "tempo message"** — the server broadcasts **SessionState**, not deltas.
- **"Session" for the browser storage API** — say **sessionStorage** explicitly.
- **"Latency compensation"** — say **Clock Offset** (the measurement) and **Anchor** (the shared instant it's applied to). "Latency" is a symptom, not a mechanism.
