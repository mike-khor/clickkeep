# Local development

This is the operational guide for running ClickKeep locally. If something here is wrong, fix it — the agents will start trusting whatever's in this file.

## Prerequisites (one-time)

- **Node 20+** (managed via `nvm`/`fnm`/Volta, whatever)
- **pnpm 9+** (`npm install -g pnpm` if you don't have it)
- That's it. No Docker, no databases, no Redis. Wrangler simulates Cloudflare locally via Miniflare; the web app is a plain Vite project.

## First-run setup

```bash
git clone <repo-url> clickkeep && cd clickkeep
pnpm install
cp apps/web/.env.example apps/web/.env
cp workers/session/.dev.vars.example workers/session/.dev.vars
```

That's it. No KV namespace, no Cloudflare account, no wrangler login needed for local dev — Wrangler simulates everything.

## Running the app

You need two terminals (or use the launch.json — see "Inside Claude Code" below).

**Terminal 1 — session worker:**

```bash
pnpm worker:dev
```

Wrangler starts on `http://localhost:8787` with a simulated Durable Object and KV namespace. Each restart wipes state — that's fine for development.

**Terminal 2 — web app:**

```bash
pnpm dev
```

Vite serves the React app on `http://localhost:5173`. Hot-reload is on. The web app reads `VITE_SESSION_WORKER_URL` from `apps/web/.env`; default is `http://localhost:8787` so the two talk to each other out of the box.

**Open `http://localhost:5173` in your browser.**

## Inside Claude Code

The repo includes `.claude/launch.json` so the Claude Code preview panel can run both servers with one button each. Server names are `web` and `worker`. Either ask Claude ("bring up the web app in the preview") or use the preview MCP tools directly.

## What works right now

| Feature | Status |
|---|---|
| Solo metronome (audio + visual + haptic on supported devices) | ✅ |
| Tap tempo with rolling average + 2s auto-reset | ✅ |
| Dark / light / system theme toggle (top-right `☀︎ / ☾ / ⌂`) | ✅ |
| Session create (POST to worker, get 4-char code) | ✅ |
| Session join via code + member-count display + RTT readout | ✅ |
| Clock-offset measurement (NTP-style ping/pong on connect, every 30s after) | ✅ |
| Tempo broadcast from owner → members | ⏳ in BACKLOG (Now) |
| MIDI tempo map import | ⏳ in BACKLOG (Next) |
| Concert Mode | ⏳ in BACKLOG (Next) |

## Smoke-testing group sync (manual)

This is the visual test for sync until automated browser tests exist:

1. Run both servers (`worker:dev` + `dev`).
2. Open `http://localhost:5173` in **window A**.
3. Click **Create session**. Note the 4-character code.
4. Open the same URL in **window B** (private window or a different browser is best).
5. Type the code into B's join input and click **Join session**.
6. Confirm both windows show **2 members** and an RTT readout near zero (e.g. `5ms`).
7. Close window B; window A should drop to **1 member**.
8. Both windows should be able to click independently (solo audio is per-window today; synchronized broadcast is the next BACKLOG item).

## Verifying changes before opening a PR

```bash
pnpm typecheck    # all workspaces
pnpm test         # vitest, all workspaces
pnpm build        # production builds for web + worker
```

CI ([.github/workflows/ci.yml](../.github/workflows/ci.yml)) runs the same commands on every PR.

## Running e2e tests

The repo has a Playwright suite that exercises real session sync across two browser contexts. It lives in `apps/web/e2e/` and is configured in `apps/web/playwright.config.ts`.

```bash
pnpm test:e2e
```

The Playwright config auto-starts both the session worker (`pnpm worker:dev` on :8787) and the web app (`pnpm dev` on :5173) via its `webServer` array, reusing them if you already have them running locally. The Chromium browser must be installed once with:

```bash
pnpm --filter @clickkeep/web exec playwright install chromium
```

These tests are deliberately **not** included in `pnpm test` (the default vitest recipe) and CI does not run them yet — they're a manual smoke check while group-sync correctness is still landing.

## Common issues

**`pnpm worker:dev` says "out of date wrangler"** — ignore. The version pinned in `workers/session/package.json` is fine. Upgrading wrangler is a Tier 3 change (it touches a `dependencies` entry in the worker); file an issue if you need a newer version.

**`POST http://localhost:8787/sessions` fails with CORS** — the worker allows `*` origin in dev. If your browser still blocks it, you probably didn't restart `pnpm worker:dev` after editing `src/index.ts`. Wrangler usually hot-reloads, but Durable Object code sometimes needs a full restart.

**WebSocket disconnects after a minute or two** — Wrangler dev disconnects idle DOs. Send any message (e.g. let the auto-ping fire — every 30s) and reconnection just reattaches. In production this won't happen at human-scale traffic.

**`pnpm install` is slow** — only the first run. Subsequent installs use pnpm's content-addressed store.

## Deploying (when ready — not done yet)

Tracked in BACKLOG.md under "Next". Will involve:

1. `wrangler login` (one-time, owner only)
2. `wrangler kv:namespace create JOIN_CODES` → paste returned id into `workers/session/wrangler.toml`
3. `pnpm worker:deploy`
4. Connect `apps/web` to Cloudflare Pages (GitHub integration, automatic on `main`)
5. Set the production `VITE_SESSION_WORKER_URL` in Pages → Environment variables
6. Buy a domain and CNAME it to the Pages URL

Estimated effort: ~30 minutes once you have a Cloudflare account.
