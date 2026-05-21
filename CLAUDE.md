# CLAUDE.md — ClickKeep operating manual

This file orients any agent (you, future-you, a spawned subagent, a GitHub Actions agent) working in this repo. Read it before making changes.

## Project in one paragraph

ClickKeep is a free universal group metronome. Musicians join a session by 4-character code (Jackbox-style). Once joined, every device clicks in lock-step via audio, visual flash, and haptic vibration. The session owner controls tempo, can load MIDI tempo maps, and in **Concert Mode** can pre-load a setlist and advance songs while members follow. Solo mode works fully offline. Group sync uses one Cloudflare Durable Object per session — server load is near-zero because clients schedule beats locally from a shared anchor.

## Architecture invariants — DO NOT VIOLATE

1. **Clients schedule beats locally.** The server never sends "tick" messages. It sends state changes only: `{startedAt, tempoMap, currentSongId}`. If you find yourself adding per-beat server traffic, stop.
2. **Sync uses NTP-style offset.** On connect, each client measures clock offset to the Durable Object via a few round-trip samples, then schedules beats against server time translated through that offset. Resync every ~30s to correct drift.
3. **Anonymous by default.** No accounts, no PII. Session ownership is implicit ("you opened it, you control it"). Persistence is via export/import of setlist JSON or a hash-fragment URL — never via a user database.
4. **No secrets in the repo.** Cloudflare API tokens, Apple keys, etc. live in GitHub Actions secrets and `.dev.vars` (gitignored). The `.env.example` files document shape only.
5. **Free forever.** No paywalls, no upsells, no analytics that aren't strictly anonymous error counters. If a feature requires recurring user payment, it doesn't ship.

## Tech stack

- **Frontend:** Vite + React 18 + TypeScript + Tailwind + shadcn/ui + Zustand
- **Audio:** Web Audio API directly (no Tone.js for the click engine — we need raw lookahead scheduling)
- **MIDI parsing:** `@tonejs/midi`
- **Backend:** Cloudflare Workers + Durable Objects + KV (join-code → DO-id map)
- **Native shells (later):** Capacitor for iOS/Android; native SwiftUI/Compose for watch
- **Package manager:** pnpm workspaces

## Repo layout

```
apps/web/              The PWA. Source of truth for UI.
packages/click-engine/ Web Audio scheduler. Pure, no React. Testable in node with a fake AudioContext.
packages/sync-core/    Clock offset, tempo math, shared types. No platform dependencies.
workers/session/       Cloudflare Worker entry + Session Durable Object.
.claude/agents/pm.md   The project manager agent.
.github/workflows/     CI, tier-gated auto-merge, feedback-to-PR.
BACKLOG.md             Prioritized task queue. PM agent reads this.
```

## Local dev

```bash
pnpm install
pnpm dev               # apps/web on :5173
pnpm worker:dev        # workers/session on :8787 (separate terminal)
pnpm typecheck         # all workspaces
pnpm test              # vitest, all workspaces
pnpm build             # production builds
```

## Commit and PR conventions

- **Conventional commits**: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`. Scope optional: `feat(click-engine): ...`.
- **One concern per PR.** Drive-by refactors go in their own PR. The tier system relies on tight diffs.
- **Never commit:** `node_modules/`, `dist/`, `.env*` (except `.env.example`), `.dev.vars`, `.wrangler/`.

## Agent guardrails (READ THIS if you are a GitHub Actions agent)

The tier-gated auto-merge workflow classifies your PR by the files it touches:

- **Tier 1 — auto-merge allowed.** Only changes within:
  - `apps/web/src/copy/**`
  - `apps/web/src/styles/colors.ts`
  - `apps/web/public/**`
  - `**/*.md` (except `CLAUDE.md`, `BACKLOG.md`)
  - Comment-only changes anywhere
- **Tier 2 — owner review required (notification sent).** UI components, non-sync logic, dependency bumps. Posts a summary to the issue and notifies the owner.
- **Tier 3 — hard-blocked, explicit `/approve` required from owner.** Any change to:
  - `packages/sync-core/**`
  - `packages/click-engine/src/scheduler.ts`
  - `workers/**`
  - `.github/workflows/**`
  - `.claude/**`
  - `CLAUDE.md`, `BACKLOG.md`
  - Any file containing the comment `// AGENT_GUARDRAIL`
  - `package.json` `dependencies` or `scripts` keys (devDependencies bumps stay tier 2)

If you are an agent and your change would touch Tier 3 files: split the PR so the Tier 3 portion is isolated, or stop and ask in the issue thread.

## What "done" means

Before opening a PR, ensure:

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes (or you've added failing tests describing the bug, with a note)
- [ ] `pnpm build` succeeds
- [ ] Manual test in browser: the feature works in both dark and light mode
- [ ] No `console.log`, no commented-out code, no TODO without a BACKLOG entry
- [ ] PR description states tier expectation and references the issue
