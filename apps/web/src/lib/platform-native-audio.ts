import type { BeatState } from '@clickkeep/click-engine';

/**
 * Runtime-only handle for the native iOS metronome plugin
 * (`packages/native-metronome/`).
 *
 * Web Audio suspends the moment the WKWebView backgrounds, so on iOS we
 * hand the click over to AVAudioEngine driven from Swift. In the browser
 * or on any non-iOS Capacitor platform this returns null and callers
 * skip the handoff.
 *
 * Following the same pattern as `platform-haptic.ts`: we look up the
 * plugin via `window.Capacitor.Plugins.NativeMetronome` at runtime instead
 * of importing `@clickkeep/native-metronome`, so the web bundle stays
 * free of native deps and works fine in a plain browser.
 */

export interface NativeMetronomeStartOptions {
  bpm: number;
  beatsPerBar: number;
  accentPattern?: BeatState[];
  /** Wall-clock ms of beat 0 in the current session. See plugin definitions.ts. */
  anchorEpochMs?: number;
}

export interface NativeMetronomeHandle {
  start(opts: NativeMetronomeStartOptions): Promise<void>;
  stop(): Promise<void>;
  updateTempo(opts: NativeMetronomeStartOptions): Promise<void>;
}

interface CapacitorNativeMetronomePlugin {
  start: (opts: NativeMetronomeStartOptions) => Promise<void>;
  stop: () => Promise<void>;
  updateTempo: (opts: NativeMetronomeStartOptions) => Promise<void>;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: { NativeMetronome?: CapacitorNativeMetronomePlugin };
}

/**
 * Return a handle to the native metronome, or null if we're not running
 * inside the iOS Capacitor shell. Callers should treat null as "no
 * background audio available — do nothing" and let the Web Audio path
 * keep going as if the visibility change had no other consequences.
 */
export function getNativeMetronome(): NativeMetronomeHandle | null {
  const cap = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (cap === undefined) return null;
  if (typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return null;
  // Only iOS ships the native plugin today. Android would need its own
  // implementation; guarding on getPlatform() keeps a future Android
  // build from silently silent-failing when the plugin isn't installed.
  if (typeof cap.getPlatform === 'function' && cap.getPlatform() !== 'ios') return null;
  const plugin = cap.Plugins?.NativeMetronome;
  if (plugin === undefined) return null;
  return {
    start: (opts) => plugin.start(opts),
    stop: () => plugin.stop(),
    updateTempo: (opts) => plugin.updateTempo(opts),
  };
}
