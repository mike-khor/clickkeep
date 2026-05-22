// Parse a MIDI file's header tempo events into a flat, sorted tempo map.
// We deliberately use only `header.tempos` from @tonejs/midi — per-track
// tempos and time-signature changes are out of scope for this PR.

import { Midi } from '@tonejs/midi';

export interface TempoChange {
  // Seconds from the start of the MIDI file at which this BPM applies.
  timeSec: number;
  bpm: number;
}

export type TempoMap = TempoChange[];

// Clamp to match store.setBpm bounds so a wild MIDI tempo can't desync UI.
const BPM_MIN = 30;
const BPM_MAX = 300;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Parse a MIDI buffer into a sorted tempo map.
 *
 * - Uses @tonejs/midi's already-computed `tempos[].time` (seconds) — we don't
 *   recompute ticks→seconds ourselves.
 * - If the MIDI has no tempo events, @tonejs/midi defaults to 120 BPM; we
 *   surface that as a single-entry map so the timeline always has something
 *   to render.
 * - Adjacent duplicates (same BPM at successive timestamps) are collapsed so
 *   the timeline doesn't show noise from no-op tempo events.
 */
export function parseTempoMap(data: ArrayBuffer | ArrayLike<number>): TempoMap {
  const midi = new Midi(data);
  const raw = midi.header.tempos;

  // No explicit tempos: fall back to @tonejs/midi's implicit 120 BPM at t=0.
  if (raw.length === 0) {
    return [{ timeSec: 0, bpm: 120 }];
  }

  const sorted = [...raw].sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
  const out: TempoMap = [];
  for (const ev of sorted) {
    const bpm = clamp(ev.bpm, BPM_MIN, BPM_MAX);
    const timeSec = Math.max(0, ev.time ?? 0);
    const last = out[out.length - 1];
    if (last !== undefined && last.bpm === bpm) continue;
    out.push({ timeSec, bpm });
  }
  return out;
}

/**
 * Format `seconds` as `M:SS` for the timeline display. Negative or NaN
 * collapses to 0:00 so we never render junk.
 */
export function formatTimeSec(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
