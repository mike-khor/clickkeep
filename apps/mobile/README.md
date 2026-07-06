# @clickkeep/mobile

Capacitor iOS shell around the ClickKeep PWA. Wraps `apps/web` in a native
container so iOS haptics can fire from the Taptic Engine (Safari blocks
`navigator.vibrate`, so the browser fallback is silent on iPhone).

## One-time setup

1. Install Xcode from the Mac App Store (~30 GB).
2. Switch xcode-select at the Xcode app:
   `sudo xcode-select --switch /Applications/Xcode.app`
3. Install CocoaPods: `sudo gem install cocoapods` (or `brew install cocoapods`).
4. From `apps/mobile/`: `pnpm cap add ios` (creates the native project).

## Dev workflow

1. From the repo root, start the web app: `pnpm dev` — Vite binds to the
   LAN on port 5173.
2. Confirm `capacitor.config.ts`'s `server.url` matches your Mac's LAN
   IP. Update it and re-run `pnpm cap sync ios` if your IP changed.
3. Open the Xcode workspace: `pnpm ios:open` (from `apps/mobile/`).
4. In Xcode, select your iPhone as the run destination, sign with your
   personal team under **Signing & Capabilities**, then hit Run.
5. On the iPhone the first time: Settings → General → VPN & Device
   Management → trust the developer profile.

## Production build (later)

Delete the `server` block from `capacitor.config.ts`, run
`pnpm --filter @clickkeep/web build`, copy the output into
`apps/mobile/www/`, then `pnpm cap sync ios`.
