import type { TempoSegment } from './types.js';

/**
 * Given a tempo map and a target server time, return the beat number
 * (fractional) at that moment, plus the beat-period in ms (for scheduling
 * the next click). Beat 0 is the first downbeat of the song.
 *
 * Each segment is constant-BPM. Beat count accumulates across segments.
 */
export function beatAtServerTime(tempo: TempoSegment[], serverTimeMs: number): {
  beat: number;
  beatPeriodMs: number;
  segmentIndex: number;
} {
  if (tempo.length === 0) {
    return { beat: 0, beatPeriodMs: 500, segmentIndex: -1 };
  }
  let accumulatedBeats = 0;
  for (let i = 0; i < tempo.length; i++) {
    const seg = tempo[i]!;
    const next = tempo[i + 1];
    const periodMs = 60_000 / seg.bpm;
    const segEndAt = next?.startAt ?? Infinity;
    if (serverTimeMs < seg.startAt) {
      // Before the song starts — clamp to beat 0.
      return { beat: 0, beatPeriodMs: periodMs, segmentIndex: i };
    }
    if (serverTimeMs < segEndAt) {
      const elapsedMs = serverTimeMs - seg.startAt;
      return {
        beat: accumulatedBeats + elapsedMs / periodMs,
        beatPeriodMs: periodMs,
        segmentIndex: i,
      };
    }
    const segDurationMs = segEndAt - seg.startAt;
    accumulatedBeats += segDurationMs / periodMs;
  }
  // Past the end: pin to last segment.
  const last = tempo[tempo.length - 1]!;
  return { beat: accumulatedBeats, beatPeriodMs: 60_000 / last.bpm, segmentIndex: tempo.length - 1 };
}

/**
 * Inverse of beatAtServerTime: when (in server time) does a given beat number occur?
 * Used to schedule the next beat precisely.
 */
export function serverTimeForBeat(tempo: TempoSegment[], targetBeat: number): number {
  if (tempo.length === 0 || targetBeat < 0) {
    return tempo[0]?.startAt ?? 0;
  }
  let accumulatedBeats = 0;
  for (let i = 0; i < tempo.length; i++) {
    const seg = tempo[i]!;
    const next = tempo[i + 1];
    const periodMs = 60_000 / seg.bpm;
    const segEndAt = next?.startAt ?? Infinity;
    const segDurationMs = segEndAt - seg.startAt;
    const segBeats = segDurationMs / periodMs;
    if (targetBeat <= accumulatedBeats + segBeats) {
      const beatsIntoSegment = targetBeat - accumulatedBeats;
      return seg.startAt + beatsIntoSegment * periodMs;
    }
    accumulatedBeats += segBeats;
  }
  // Past end — extrapolate linearly at last tempo.
  const last = tempo[tempo.length - 1]!;
  const beatsPast = targetBeat - accumulatedBeats;
  return (tempo[tempo.length - 1]?.startAt ?? 0) + beatsPast * (60_000 / last.bpm);
}
