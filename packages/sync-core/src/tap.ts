export interface TapTempoOptions {
  /** Maximum gap between taps before the rolling window resets, in ms. */
  resetAfterMs?: number;
  /** Number of recent intervals to average over. */
  windowSize?: number;
  /** Reject intervals outside this BPM range. */
  minBpm?: number;
  maxBpm?: number;
}

const DEFAULT_OPTS: Required<TapTempoOptions> = {
  resetAfterMs: 2000,
  windowSize: 4,
  minBpm: 30,
  maxBpm: 300,
};

/**
 * Stateful tap-tempo helper. Call `tap(performance.now())` on each user tap;
 * returns the current best-estimate BPM or null if not enough data yet.
 *
 * Implementation notes:
 *   - Only the last N intervals contribute to the average (rolling window).
 *   - A gap longer than resetAfterMs clears the buffer — the user is starting over.
 *   - Out-of-range intervals are dropped (likely accidental double-tap or pause).
 */
export class TapTempo {
  private readonly opts: Required<TapTempoOptions>;
  private timestamps: number[] = [];

  constructor(opts: TapTempoOptions = {}) {
    this.opts = { ...DEFAULT_OPTS, ...opts };
  }

  tap(nowMs: number): number | null {
    const last = this.timestamps[this.timestamps.length - 1];
    if (last !== undefined && nowMs - last > this.opts.resetAfterMs) {
      this.timestamps = [];
    }
    this.timestamps.push(nowMs);
    // Keep only as many timestamps as needed to form `windowSize` intervals.
    const maxKeep = this.opts.windowSize + 1;
    if (this.timestamps.length > maxKeep) {
      this.timestamps = this.timestamps.slice(-maxKeep);
    }
    return this.bpm();
  }

  bpm(): number | null {
    if (this.timestamps.length < 2) return null;
    const intervals: number[] = [];
    for (let i = 1; i < this.timestamps.length; i++) {
      intervals.push(this.timestamps[i]! - this.timestamps[i - 1]!);
    }
    const minIntervalMs = 60_000 / this.opts.maxBpm;
    const maxIntervalMs = 60_000 / this.opts.minBpm;
    const valid = intervals.filter((iv) => iv >= minIntervalMs && iv <= maxIntervalMs);
    if (valid.length === 0) return null;
    const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
    return 60_000 / mean;
  }

  reset(): void {
    this.timestamps = [];
  }
}
