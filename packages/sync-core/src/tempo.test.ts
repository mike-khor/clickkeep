import { describe, expect, it } from 'vitest';
import { beatAtServerTime, isAccentBeat, serverTimeForBeat } from './tempo.js';
import type { TempoSegment } from './types.js';

describe('tempo map', () => {
  const constant120: TempoSegment[] = [{ startAt: 1000, bpm: 120, beatsPerBar: 4 }];

  it('returns beat 0 before song start', () => {
    expect(beatAtServerTime(constant120, 500).beat).toBe(0);
  });

  it('counts beats at constant tempo', () => {
    // 120 BPM → 500ms per beat. At 2000ms (1s in), expect 2 beats.
    expect(beatAtServerTime(constant120, 2000).beat).toBe(2);
    expect(beatAtServerTime(constant120, 3000).beat).toBe(4);
  });

  it('inverts to server time for a target beat', () => {
    expect(serverTimeForBeat(constant120, 0)).toBe(1000);
    expect(serverTimeForBeat(constant120, 2)).toBe(2000);
  });

  it('handles tempo changes across segments', () => {
    // 120 BPM for the first second (2 beats), then 240 BPM.
    const map: TempoSegment[] = [
      { startAt: 0, bpm: 120, beatsPerBar: 4 },
      { startAt: 1000, bpm: 240, beatsPerBar: 4 },
    ];
    // At t=0: beat 0. At t=1000: beat 2 (boundary, second segment starts).
    // At t=1500: 2 + 500ms * (240/60000) = 2 + 2 = 4 beats.
    expect(beatAtServerTime(map, 1000).beat).toBe(2);
    expect(beatAtServerTime(map, 1500).beat).toBe(4);
  });

  describe('isAccentBeat', () => {
    // Regression: audio accent must align with the user-chosen beatsPerBar,
    // not a hardcoded 4. See fix/beats-per-bar-accent.
    it('accents every 4th beat when beatsPerBar = 4', () => {
      const map: TempoSegment[] = [{ startAt: 0, bpm: 120, beatsPerBar: 4 }];
      const accents = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((b) => isAccentBeat(map, b));
      expect(accents).toEqual([true, false, false, false, true, false, false, false, true]);
    });

    it('accents every 3rd beat when beatsPerBar = 3 (waltz)', () => {
      const map: TempoSegment[] = [{ startAt: 0, bpm: 120, beatsPerBar: 3 }];
      const accents = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((b) => isAccentBeat(map, b));
      expect(accents).toEqual([true, false, false, true, false, false, true, false, false, true]);
    });

    it('accents every 5th beat when beatsPerBar = 5', () => {
      const map: TempoSegment[] = [{ startAt: 0, bpm: 120, beatsPerBar: 5 }];
      const accents = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((b) => isAccentBeat(map, b));
      expect(accents).toEqual([
        true, false, false, false, false, true, false, false, false, false, true,
      ]);
    });

    it('handles meters 2 through 8', () => {
      for (const bpb of [2, 3, 4, 5, 6, 7, 8]) {
        const map: TempoSegment[] = [{ startAt: 0, bpm: 120, beatsPerBar: bpb }];
        for (let beat = 0; beat < bpb * 3; beat++) {
          expect(isAccentBeat(map, beat)).toBe(beat % bpb === 0);
        }
      }
    });

    it('restarts accent at each tempo-segment boundary when beatsPerBar varies', () => {
      // Segment 1: 4 beats at 4/4 → beats 0..3 belong here, beat 0 accented.
      // Segment 2: starts at beat 4 in 3/4 → accent on beats 4, 7, 10, ...
      const map: TempoSegment[] = [
        { startAt: 0, bpm: 60, beatsPerBar: 4 }, // 60 BPM = 1000ms/beat, 4 beats = 4000ms
        { startAt: 4000, bpm: 60, beatsPerBar: 3 },
      ];
      // First segment.
      expect(isAccentBeat(map, 0)).toBe(true);
      expect(isAccentBeat(map, 1)).toBe(false);
      expect(isAccentBeat(map, 2)).toBe(false);
      expect(isAccentBeat(map, 3)).toBe(false);
      // Boundary — beat 4 is the first beat of the new (3/4) segment.
      expect(isAccentBeat(map, 4)).toBe(true);
      expect(isAccentBeat(map, 5)).toBe(false);
      expect(isAccentBeat(map, 6)).toBe(false);
      expect(isAccentBeat(map, 7)).toBe(true);
      expect(isAccentBeat(map, 8)).toBe(false);
      expect(isAccentBeat(map, 9)).toBe(false);
      expect(isAccentBeat(map, 10)).toBe(true);
    });

    it('returns false for empty tempo map', () => {
      expect(isAccentBeat([], 0)).toBe(false);
    });
  });

  it('round-trips beat → time → beat', () => {
    const map: TempoSegment[] = [
      { startAt: 0, bpm: 100, beatsPerBar: 4 },
      { startAt: 2400, bpm: 150, beatsPerBar: 4 }, // 4 beats at 100 BPM
    ];
    for (const targetBeat of [0, 1, 3.5, 4, 5, 10]) {
      const time = serverTimeForBeat(map, targetBeat);
      const recovered = beatAtServerTime(map, time).beat;
      expect(recovered).toBeCloseTo(targetBeat, 6);
    }
  });
});
