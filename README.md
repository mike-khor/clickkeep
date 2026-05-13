# ClickKeep

A free, universal group metronome for musicians. Web, mobile, watch — sound, visual, haptic. Synchronized across devices with minimal backend.

## Why

Bands, choirs, and ensembles need a tempo source everyone agrees on. Hardware clicks chain devices together; ClickKeep keeps everyone in sync over the network instead — every player on their own device, no wires, no Bluetooth fiddling.

## Status

Early scaffold. Solo metronome works in the browser; group sync via Cloudflare Durable Objects is in progress.

## Repository layout

```
apps/web/             Vite + React PWA (primary frontend)
packages/click-engine Web Audio scheduler (sample-accurate beats)
packages/sync-core    Clock-offset measurement + tempo map types
workers/session       Cloudflare Worker + Durable Object (one DO per session)
.claude/agents/       Subagent definitions (PM, etc.)
.github/workflows/    CI + tiered auto-merge for agent-authored PRs
BACKLOG.md            Roadmap and task queue (PM agent reads this)
CLAUDE.md             Conventions and operating instructions for agents
```

## Quick start

```bash
pnpm install
pnpm dev          # runs the web app at http://localhost:5173
pnpm worker:dev   # runs the session worker at http://localhost:8787 (separate terminal)
```

Open `http://localhost:5173`. Full setup, troubleshooting, and the manual sync smoke-test are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). See [CLAUDE.md](CLAUDE.md) for conventions and the agent tier policy.

## License

MIT. Eventually public; currently private during early development.
