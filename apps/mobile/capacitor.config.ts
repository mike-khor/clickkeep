import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.clickkeep.mobile',
  appName: 'ClickKeep',
  webDir: 'www',
  server: {
    // Dev mode: load from Vite on the Mac over LAN. iPhone must be on the
    // same Wi-Fi. Update this IP if your Mac's LAN address changes, then
    // re-run `pnpm cap sync ios`. For production, delete the whole `server`
    // block and populate `www/` with the built web bundle.
    url: 'http://192.168.0.118:5173',
    cleartext: true,
  },
};

export default config;
