/**
 * Fire a short haptic pulse. Web browsers use navigator.vibrate (Safari iOS
 * blocks this — the Capacitor iOS shell installs a native Taptic-Engine impl
 * via setHapticImpl at boot). No-op on platforms with neither.
 */

export type HapticImpl = (durationMs: number) => void;

let installed: HapticImpl | null = null;

/** Install a platform-specific haptic implementation. Pass null to restore the default. */
export function setHapticImpl(impl: HapticImpl | null): void {
  installed = impl;
}

export function pulse(durationMs = 30): void {
  if (installed !== null) {
    installed(durationMs);
    return;
  }
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
