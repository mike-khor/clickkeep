import { describe, expect, it } from 'vitest';
import { beatStateAt, nextBeatBoundaryPastLead, reanchor } from './beat-state.js';

describe('beatStateAt', () => {
  it('applies a supplied pattern cyclically', () => {
    const pattern = ['accent', 'mute', 'normal'] as const;
    expect(beatStateAt([...pattern], 0, 4)).toBe('accent');
    expect(beatStateAt([...pattern], 1, 4)).toBe('mute');
    expect(beatStateAt([...pattern], 2, 4)).toBe('normal');
    // Wraps mod pattern.length, NOT beatsPerBar — pattern length is authoritative.
    expect(beatStateAt([...pattern], 3, 4)).toBe('accent');
    expect(beatStateAt([...pattern], 5, 4)).toBe('normal');
  });

  it('handles negative beat indices without going out of range', () => {
    const pattern = ['accent', 'normal', 'normal', 'normal'] as const;
    expect(beatStateAt([...pattern], -1, 4)).toBe('normal');
    expect(beatStateAt([...pattern], -4, 4)).toBe('accent');
  });

  it('falls back to accent-on-downbeat when pattern is empty', () => {
    // The pre-refactor scheduler returned "normal" unconditionally here, which
    // silently stripped the natural accent. beatStateAt matches the click-engine
    // scheduler default (isAccentBeat): accent on every beatsPerBar-th beat.
    expect(beatStateAt([], 0, 4)).toBe('accent');
    expect(beatStateAt([], 1, 4)).toBe('normal');
    expect(beatStateAt([], 4, 4)).toBe('accent');
    expect(beatStateAt([], 7, 4)).toBe('normal');
    expect(beatStateAt([], 8, 4)).toBe('accent');
  });

  it('empty pattern with beatsPerBar=0 or negative treats every beat as accent', () => {
    // Degenerate but defined: bpb clamps to 1 so mod is always 0.
    expect(beatStateAt([], 0, 0)).toBe('accent');
    expect(beatStateAt([], 5, 0)).toBe('accent');
  });
});

describe('reanchor', () => {
  it('produces an anchor that IS beat 0 on the new grid', () => {
    // Started at t=1000ms, 120 BPM (500ms/beat), 4/4 signature. "Now" is 2100ms,
    // meaning 2.2 beats have elapsed at the old tempo — rounds to beat 2.
    const current = { startAt: 1000, bpm: 120, beatsPerBar: 4 };
    const next = reanchor(current, 90, 3, 2100);
    // Rounded to beat 2 at old tempo: startAt = 1000 + 2 * 500 = 2000.
    expect(next.startAt).toBe(2000);
    expect(next.bpm).toBe(90);
    expect(next.beatsPerBar).toBe(3);
  });

  it('clamps negative elapsed to zero so pre-anchor times give beat 0', () => {
    const current = { startAt: 5000, bpm: 120, beatsPerBar: 4 };
    const next = reanchor(current, 60, 4, 4000);
    expect(next.startAt).toBe(5000);
    expect(next.bpm).toBe(60);
  });

  it('is idempotent when nowMs already sits on a beat boundary', () => {
    const current = { startAt: 0, bpm: 60, beatsPerBar: 4 }; // 1000ms/beat
    const next = reanchor(current, 90, 4, 3000);
    // 3 beats elapsed at old tempo → startAt = 3000.
    expect(next.startAt).toBe(3000);
  });
});

describe('nextBeatBoundaryPastLead', () => {
  it('returns the next beat boundary at least leadMs in the future', () => {
    const prev = { startAt: 0, bpm: 120, beatsPerBar: 4 }; // 500ms/beat
    // now=100, next natural boundary is 500 (400ms ahead) — clears a 150ms lead.
    expect(nextBeatBoundaryPastLead(prev, 100, 150)).toBe(500);
  });

  it('advances past any boundary that falls inside the lead window', () => {
    const prev = { startAt: 0, bpm: 120, beatsPerBar: 4 }; // 500ms/beat
    // now=450, next natural boundary is 500 (only 50ms ahead) — too close for a
    // 150ms lead, so we push to the following boundary at 1000.
    expect(nextBeatBoundaryPastLead(prev, 450, 150)).toBe(1000);
  });

  it('returns startAt itself when now equals startAt and lead is zero', () => {
    const prev = { startAt: 1000, bpm: 60, beatsPerBar: 4 };
    // now === startAt: 0 beats elapsed, next boundary is startAt itself.
    // With lead 0, that boundary satisfies (nextBeatAt - now >= 0), so it stands.
    expect(nextBeatBoundaryPastLead(prev, 1000, 0)).toBe(1000);
  });
});
