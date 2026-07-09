/**
 * TypeScript surface for the ClickKeep native iOS metronome plugin.
 *
 * Web Audio suspends on iOS the moment the WKWebView backgrounds, so the
 * PWA can't keep clicking through a screen lock without a native fallback.
 * This plugin drives AVAudioEngine from a high-priority dispatch timer so
 * the click keeps firing until `stop()` is called or the app is killed.
 *
 * Solo-mode only. Group sessions get the current tempo pushed through the
 * existing Zustand store, so `updateTempo` is enough to stay in step.
 */
// Re-exported from the click-engine so the native plugin, the Web Audio
// scheduler, and the accent-pattern UI all agree on the vocabulary. Using
// `import type` keeps this a zero-cost dependency at build time.
import type { BeatState } from '@clickkeep/click-engine';
export type { BeatState };

export interface StartOptions {
  /** Beats per minute. Clamped inside the native side to [30, 300]. */
  bpm: number;
  /**
   * Beats per bar. Used to decide accents when `accentPattern` is not
   * supplied: beat 0 of each bar is accented.
   */
  beatsPerBar: number;
  /**
   * Optional per-beat accent map. When present it overrides the
   * `beatsPerBar` accent rule and is applied cyclically. `mute` means the
   * corresponding beat plays no sound.
   */
  accentPattern?: BeatState[];
  /**
   * Wall-clock (ms since epoch) instant of "beat 0" in the current
   * playback session. When supplied, native computes the next true beat
   * index from this anchor and delays the first tick to land on that
   * beat's grid position — so the accent falls on the correct beat and
   * the audio phase stays aligned with the JS scheduler that ran before
   * the handoff. Omit to start immediately at beat 0 (legacy behavior).
   */
  anchorEpochMs?: number;
}

export type UpdateTempoOptions = StartOptions;

export interface NativeMetronomePlugin {
  /** Begin scheduling clicks. Idempotent — an already-running engine restarts with the new options. */
  start(options: StartOptions): Promise<void>;
  /** Stop scheduling and tear down the AVAudioEngine. */
  stop(): Promise<void>;
  /** Change tempo, bar length, or accent pattern without a perceptible pause. */
  updateTempo(options: UpdateTempoOptions): Promise<void>;
}
