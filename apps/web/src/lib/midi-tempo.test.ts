import { describe, expect, it } from 'vitest';
import { Midi } from '@tonejs/midi';
import { formatTimeSec, parseTempoMap } from './midi-tempo.js';

// Build MIDI fixtures programmatically with @tonejs/midi so we don't have to
// vendor binary files. `header.tempos` accepts ticks; @tonejs/midi computes
// the `time` (seconds) for us after `header.update()`.

function buildMidi(tempos: { ticks: number; bpm: number }[]): ArrayBuffer {
  const midi = new Midi();
  // One empty track keeps the file structurally valid.
  midi.addTrack();
  midi.header.tempos = tempos.map((t) => ({ ticks: t.ticks, bpm: t.bpm }));
  midi.header.update();
  return midi.toArray().buffer.slice(0) as ArrayBuffer;
}

describe('parseTempoMap', () => {
  it('returns a single 120 BPM entry when the MIDI has no tempo events', () => {
    const buf = buildMidi([]);
    const map = parseTempoMap(buf);
    expect(map).toEqual([{ timeSec: 0, bpm: 120 }]);
  });

  it('returns one entry for a single-tempo MIDI', () => {
    const buf = buildMidi([{ ticks: 0, bpm: 140 }]);
    const map = parseTempoMap(buf);
    expect(map).toHaveLength(1);
    const first = map[0]!;
    // MIDI encodes tempo as microseconds-per-quarter, so the round-trip can
    // drift a few ten-thousandths. Compare with tolerance, not equality.
    expect(first.bpm).toBeCloseTo(140, 2);
    expect(first.timeSec).toBeCloseTo(0, 5);
  });

  it('returns multi-tempo entries sorted by time', () => {
    // @tonejs/midi default PPQ is 480. A tempo change at ticks=960 with the
    // initial 120 BPM lands at 1.0s (two quarter notes at 0.5s each).
    const buf = buildMidi([
      { ticks: 0, bpm: 120 },
      { ticks: 960, bpm: 132 },
    ]);
    const map = parseTempoMap(buf);
    expect(map).toHaveLength(2);
    const a = map[0]!;
    const b = map[1]!;
    expect(a.bpm).toBeCloseTo(120, 2);
    expect(b.bpm).toBeCloseTo(132, 2);
    expect(a.timeSec).toBeLessThan(b.timeSec);
    expect(b.timeSec).toBeCloseTo(1.0, 2);
  });

  it('collapses adjacent duplicate BPM events', () => {
    const buf = buildMidi([
      { ticks: 0, bpm: 100 },
      { ticks: 480, bpm: 100 },
      { ticks: 960, bpm: 120 },
    ]);
    const map = parseTempoMap(buf);
    expect(map).toHaveLength(2);
    expect(map[0]!.bpm).toBeCloseTo(100, 2);
    expect(map[1]!.bpm).toBeCloseTo(120, 2);
  });

  it('clamps out-of-range BPM into the metronome window', () => {
    const buf = buildMidi([
      { ticks: 0, bpm: 10 },
      { ticks: 480, bpm: 500 },
    ]);
    const map = parseTempoMap(buf);
    expect(map[0]!.bpm).toBe(30);
    expect(map[1]!.bpm).toBe(300);
  });
});

describe('formatTimeSec', () => {
  it('formats whole seconds as M:SS', () => {
    expect(formatTimeSec(0)).toBe('0:00');
    expect(formatTimeSec(8)).toBe('0:08');
    expect(formatTimeSec(75)).toBe('1:15');
  });
  it('handles negatives and NaN safely', () => {
    expect(formatTimeSec(-1)).toBe('0:00');
    expect(formatTimeSec(Number.NaN)).toBe('0:00');
  });
});
