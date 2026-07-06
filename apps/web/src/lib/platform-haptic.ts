import { setHapticImpl } from '@clickkeep/click-engine';

interface CapacitorHapticsPlugin {
  impact: (opts: { style: 'HEAVY' | 'MEDIUM' | 'LIGHT' }) => Promise<void>;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: { Haptics?: CapacitorHapticsPlugin };
}

/**
 * When running inside the Capacitor iOS shell, swap the click-engine's
 * default navigator.vibrate haptic (which Safari iOS blocks) for the
 * native Taptic Engine via @capacitor/haptics. In an ordinary browser
 * this is a no-op and click-engine keeps its default.
 *
 * We look up window.Capacitor at runtime instead of importing
 * `@capacitor/haptics` so this package stays free of native deps.
 */
export function installPlatformHaptic(): void {
  const cap = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (cap === undefined) return;
  if (typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return;
  const haptics = cap.Plugins?.Haptics;
  if (haptics === undefined) return;
  setHapticImpl((durationMs) => {
    // Web pulse durations are 20 ms (normal) / 60 ms (accent). The Taptic
    // Engine takes a discrete style, not a duration. Map the two known
    // durations to LIGHT / HEAVY; anything else falls back to MEDIUM.
    const style = durationMs >= 60 ? 'HEAVY' : durationMs <= 20 ? 'LIGHT' : 'MEDIUM';
    void haptics.impact({ style });
  });
}
