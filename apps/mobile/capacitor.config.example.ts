// Template — copy this file to `capacitor.config.ts` and replace
// <YOUR_MAC_LAN_IP> with your Mac's actual LAN IP (find it via
// `ipconfig getifaddr en0`). The real `capacitor.config.ts` is gitignored
// so each developer keeps their own copy — do not commit LAN IPs. Re-run
// `pnpm cap sync ios` after any edit. For production, delete the whole
// `server` block and populate `www/` with the built web bundle.
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.clickkeep.mobile',
  appName: 'ClickKeep',
  webDir: 'www',
  server: {
    // Dev mode: load from Vite on the Mac over LAN. iPhone must be on the
    // same Wi-Fi.
    url: 'http://<YOUR_MAC_LAN_IP>:5173',
    cleartext: true,
  },
};

export default config;
