import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TempoSegment } from '@clickkeep/sync-core';
import { startClick } from './scheduler.js';
import type { BeatState, Voice } from './voices.js';

// Minimal fake AudioContext sufficient for the scheduler. The scheduler only
// reads `currentTime` and `destination`; voices create nodes and connect them.
// We record voice invocations directly via a custom Voice spy, so the fake
// only needs to satisfy node construction without throwing.
class FakeAudioParam {
  setValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
  cancelScheduledValues = vi.fn();
  value = 0;
}

class FakeNode {
  connect = vi.fn().mockImplementation((next: FakeNode) => next);
  start = vi.fn();
  stop = vi.fn();
  frequency = new FakeAudioParam();
  gain = new FakeAudioParam();
  Q = new FakeAudioParam();
  type = '';
  buffer: AudioBuffer | null = null;
}

class FakeBuffer {
  constructor(private readonly frames: number) {}
  getChannelData(): Float32Array {
    return new Float32Array(this.frames);
  }
}

class FakeAudioContext {
  currentTime = 0;
  sampleRate = 48000;
  destination = new FakeNode();
  createOscillator = vi.fn(() => new FakeNode());
  createGain = vi.fn(() => new FakeNode());
  createBufferSource = vi.fn(() => new FakeNode());
  createBiquadFilter = vi.fn(() => new FakeNode());
  createBuffer = vi.fn((_ch: number, frames: number) => new FakeBuffer(frames));
}

function makeCtx(): AudioContext {
  return new FakeAudioContext() as unknown as AudioContext;
}

const constant120: TempoSegment[] = [{ startAt: 0, bpm: 120, beatsPerBar: 4 }];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('startClick', () => {
  it('calls the default pitched voice on each scheduled beat', () => {
    const ctx = makeCtx() as FakeAudioContext & AudioContext;
    let now = 0;
    const beats: number[] = [];
    const handle = startClick(constant120, {
      audioCtx: ctx,
      nowServerMs: () => now,
      onBeatScheduled: (beat) => beats.push(beat),
      // default voice (pitched) — verify by inspecting created oscillator nodes
    });
    // First tick fires synchronously; with 120 BPM (500ms/beat) and a 100ms
    // lookahead at t=0, only beat 0 is within reach.
    expect(beats).toEqual([0]);
    // pitched voice uses one oscillator + one gain per beat.
    expect(ctx.createOscillator).toHaveBeenCalledTimes(1);
    expect(ctx.createGain).toHaveBeenCalledTimes(1);

    // Advance server time + audio clock to reach beat 1 (at 500ms), within
    // lookahead horizon of the next 25ms tick.
    now = 450;
    ctx.currentTime = 0.45;
    vi.advanceTimersByTime(25);
    expect(beats).toEqual([0, 1]);

    handle.stop();
  });

  it('resolves a profile id to its voice', () => {
    const ctx = makeCtx() as FakeAudioContext & AudioContext;
    const handle = startClick(constant120, {
      audioCtx: ctx,
      nowServerMs: () => 0,
      onBeatScheduled: () => undefined,
      voice: 'woodblock',
    });
    // Woodblock uses a noise buffer source + band-pass filter + gain.
    expect(ctx.createBufferSource).toHaveBeenCalledTimes(1);
    expect(ctx.createBiquadFilter).toHaveBeenCalledTimes(1);
    expect(ctx.createOscillator).not.toHaveBeenCalled();
    handle.stop();
  });

  it('accepts a custom Voice function and passes state through', () => {
    const ctx = makeCtx();
    const states: BeatState[] = [];
    const voice: Voice = ({ state }) => {
      states.push(state);
    };
    const handle = startClick(constant120, {
      audioCtx: ctx,
      nowServerMs: () => 0,
      onBeatScheduled: () => undefined,
      voice,
    });
    // Beat 0 is the segment downbeat → accent by default.
    expect(states).toEqual(['accent']);
    handle.stop();
  });

  it('honors beatStateFor: mute skips voice but still fires onBeatScheduled', () => {
    const ctx = makeCtx() as FakeAudioContext & AudioContext;
    const beats: number[] = [];
    const voiceCalls: BeatState[] = [];
    const voice: Voice = ({ state }) => voiceCalls.push(state);
    let now = 0;

    const handle = startClick(constant120, {
      audioCtx: ctx,
      nowServerMs: () => now,
      onBeatScheduled: (beat) => beats.push(beat),
      voice,
      // Beat 0 = mute, beat 1 = accent, beat 2 = normal, others = normal.
      beatStateFor: (beat) => {
        if (beat === 0) return 'mute';
        if (beat === 1) return 'accent';
        return 'normal';
      },
    });

    // Beat 0 fires immediately — onBeatScheduled but no voice call.
    expect(beats).toEqual([0]);
    expect(voiceCalls).toEqual([]);

    // Advance to beat 1 (500ms).
    now = 500;
    (ctx as FakeAudioContext).currentTime = 0.5;
    vi.advanceTimersByTime(25);
    expect(beats).toEqual([0, 1]);
    expect(voiceCalls).toEqual(['accent']);

    // Advance to beat 2 (1000ms).
    now = 1000;
    (ctx as FakeAudioContext).currentTime = 1.0;
    vi.advanceTimersByTime(25);
    expect(beats).toEqual([0, 1, 2]);
    expect(voiceCalls).toEqual(['accent', 'normal']);

    handle.stop();
  });

  it('beatStateFor closure is invoked each beat (live pattern updates)', () => {
    const ctx = makeCtx() as FakeAudioContext & AudioContext;
    let pattern: BeatState[] = ['accent', 'normal', 'normal', 'normal'];
    const voiceCalls: BeatState[] = [];
    const voice: Voice = ({ state }) => voiceCalls.push(state);
    let now = 0;

    const handle = startClick(constant120, {
      audioCtx: ctx,
      nowServerMs: () => now,
      onBeatScheduled: () => undefined,
      voice,
      beatStateFor: (beat) => pattern[beat % pattern.length] ?? 'normal',
    });
    expect(voiceCalls).toEqual(['accent']);

    // Flip the pattern mid-flight — next scheduled beat should reflect it.
    pattern = ['mute', 'accent', 'mute', 'accent'];
    now = 500;
    ctx.currentTime = 0.5;
    vi.advanceTimersByTime(25);
    // Beat 1 of the new pattern is 'accent'.
    expect(voiceCalls).toEqual(['accent', 'accent']);

    handle.stop();
  });
});
