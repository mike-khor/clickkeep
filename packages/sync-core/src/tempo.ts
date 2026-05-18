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
 * Returns true if the given (integer) beat is an accent beat — i.e. the
 * downbeat of a bar in the tempo segment that beat belongs to.
 *
 * Accent restarts at every segment boundary: within a segment, the first
 * beat of that segment is the downbeat, and accents fall every
 * `beatsPerBar` beats after it. This keeps the audio accent aligned with
 * the user-selected meter even when `beatsPerBar` varies across segments.
 */
export function isAccentBeat(tempo: TempoSegment[], beat: number): boolean {
  if (tempo.length === 0) return false;
  let accumulatedBeats = 0;
  for (let i = 0; i < tempo.length; i++) {
    const seg = tempo[i]!;
    const next = tempo[i + 1];
    const periodMs = 60_000 / seg.bpm;
    const segEndAt = next?.startAt ?? Infinity;
    const segDurationMs = segEndAt - seg.startAt;
    const segBeats = segDurationMs / periodMs;
    const nextAccumulated = accumulatedBeats + segBeats;
    // Beat falls within this segment (treat segment boundary as belonging
    // to the next segment so its first beat is a downbeat).
    if (beat < nextAccumulated || next === undefined) {
      const beatsSinceSegmentStart = beat - accumulatedBeats;
      const bpb = seg.beatsPerBar > 0 ? seg.beatsPerBar : 1;
      // Use a small epsilon so floating-point segment-beat counts don't
      // shift the accent. Beats themselves are integers in the scheduler.
      const mod = ((beatsSinceSegmentStart % bpb) + bpb) % bpb;
      return mod < 1e-6 || Math.abs(mod - bpb) < 1e-6;
    }
    accumulatedBeats = nextAccumulated;
  }
  return false;
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
