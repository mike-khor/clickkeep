/**
 * Fire a short haptic pulse on supported devices. No-op on platforms without vibrate.
 * Browser support is patchy — Safari iOS blocks navigator.vibrate, so for serious
 * haptic on iOS the Capacitor wrap will swap this for the native Haptics plugin.
 */
export function pulse(durationMs = 30): void {
  if (typeof navigator === 'undefined') return;
  const nav = navigator as { vibrate?: (pattern: number | number[]) => boolean };
  if (typeof nav.vibrate === 'function') {
    nav.vibrate(durationMs);
  }
}

/**
 * Stronger accent pulse for downbeats.
 */
export function accentPulse(): void {
  pulse(60);
}
