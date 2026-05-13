import { describe, expect, it } from 'vitest';
import { beatAtServerTime, serverTimeForBeat } from './tempo.js';
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
