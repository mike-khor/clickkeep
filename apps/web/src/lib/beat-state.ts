import type { BeatState } from '@clickkeep/click-engine';

/**
 * Beat-state and anchor math shared between the scheduler callback and the
 * side-effect layer (haptic pulse, handoff timing). Extracted to a single
 * module so the modular arithmetic and reanchor logic exist in exactly one
 * place — the previous copies had drifted on the empty-pattern fallback.
 */

export interface Anchor {
  /** Wall-clock instant (ms since epoch, server time) of beat 0. */
  startAt: number;
  bpm: number;
  beatsPerBar: number;
}

/**
 * Resolve a beat's state given the user's accent pattern (index 0 = downbeat).
 *
 * With an empty pattern, we fall back to "accent on the downbeat of each bar,
 * normal elsewhere" — matching the click-engine scheduler's own default
 * (`isAccentBeat` in @clickkeep/sync-core) so muting the pattern doesn't
 * silently strip the accent.
 */
export function beatStateAt(
  pattern: BeatState[],
  beat: number,
  beatsPerBar: number,
): BeatState {
  if (pattern.length === 0) {
    const bpb = beatsPerBar > 0 ? beatsPerBar : 1;
    const mod = ((beat % bpb) + bpb) % bpb;
    return mod === 0 ? 'accent' : 'normal';
  }
  const pos = ((beat % pattern.length) + pattern.length) % pattern.length;
  return pattern[pos] ?? 'normal';
}

/**
 * Given the current anchor, a new BPM / signature, and "now" (server time in
 * ms), return a fresh anchor whose `startAt` sits on a real beat boundary of
 * the NEW grid.
 *
 * Why this matters: `handoffToWebAudio` computes elapsed beats as
 * `(now - startAt) / newPeriodMs`. If `startAt` is left at the pre-change
 * anchor, that division uses the wrong grid — the whole accent pattern lands
 * on the wrong beats for the rest of the session. This helper re-anchors so
 * `handoffToWebAudio` (and the seamless-handoff effect) always see a startAt
 * that IS beat 0 on the current grid.
 */
export function reanchor(
  current: Anchor,
  newBpm: number,
  newBeatsPerBar: number,
  nowMs: number,
): Anchor {
  const oldPeriodMs = 60_000 / current.bpm;
  const elapsedOldBeats = Math.max(0, (nowMs - current.startAt) / oldPeriodMs);
  // Round to the nearest beat on the OLD grid so the perceived phase doesn't
  // jump. That integer becomes beat 0 of the new grid, anchored at whatever
  // wall-clock instant it fell on.
  const beatIndex = Math.round(elapsedOldBeats);
  const startAt = current.startAt + beatIndex * oldPeriodMs;
  return { startAt, bpm: newBpm, beatsPerBar: newBeatsPerBar };
}

/**
 * Given an anchor and a "not before" lead time (server-time ms), return the
 * server-time of the earliest true beat boundary on that anchor's grid that
 * is at least `leadMs` in the future.
 *
 * Used by both the tempo/signature handoff and the foreground-return handoff
 * to place the fresh scheduler's first beat safely past whatever lookahead /
 * gain-restore window the caller needs to clear.
 */
export function nextBeatBoundaryPastLead(
  prev: Anchor,
  nowMs: number,
  leadMs: number,
): number {
  const periodMs = 60_000 / prev.bpm;
  const elapsed = nowMs - prev.startAt;
  const beatsElapsed = Math.max(0, elapsed / periodMs);
  let nextBeatAt = prev.startAt + Math.ceil(beatsElapsed) * periodMs;
  while (nextBeatAt - nowMs < leadMs) nextBeatAt += periodMs;
  return nextBeatAt;
}
