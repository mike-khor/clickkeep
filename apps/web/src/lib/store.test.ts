import { beforeEach, describe, expect, it } from 'vitest';
import { useMetronome } from './store.js';

// Zustand stores are singletons. Reset to defaults before each test so
// assertions don't leak between cases. Using setState (not mocking) per
// the grug rule: avoid mocking except at coarse-grained boundaries.
beforeEach(() => {
  useMetronome.setState({
    bpm: 120,
    beatsPerBar: 4,
    isPlaying: false,
    currentBeat: 0,
    muted: false,
    visualEnabled: true,
    hapticEnabled: true,
    sessionRole: 'solo',
    toneProfile: 'pitched',
    accentPattern: ['accent', 'normal', 'normal', 'normal'],
  });
});

describe('output-mode toggles', () => {
  it('defaults all three output channels to ON', () => {
    const s = useMetronome.getState();
    expect(s.muted).toBe(false);
    expect(s.visualEnabled).toBe(true);
    expect(s.hapticEnabled).toBe(true);
  });

  it('toggleMuted flips audio output independently', () => {
    useMetronome.getState().toggleMuted();
    expect(useMetronome.getState().muted).toBe(true);
    expect(useMetronome.getState().visualEnabled).toBe(true);
    expect(useMetronome.getState().hapticEnabled).toBe(true);
  });

  it('toggleVisualEnabled flips only visual', () => {
    useMetronome.getState().toggleVisualEnabled();
    expect(useMetronome.getState().visualEnabled).toBe(false);
    expect(useMetronome.getState().muted).toBe(false);
    expect(useMetronome.getState().hapticEnabled).toBe(true);
  });

  it('toggleHapticEnabled flips only haptic', () => {
    useMetronome.getState().toggleHapticEnabled();
    expect(useMetronome.getState().hapticEnabled).toBe(false);
    expect(useMetronome.getState().muted).toBe(false);
    expect(useMetronome.getState().visualEnabled).toBe(true);
  });

  it('explicit setters override toggle state', () => {
    useMetronome.getState().setVisualEnabled(false);
    useMetronome.getState().setHapticEnabled(false);
    useMetronome.getState().setMuted(true);
    const s = useMetronome.getState();
    expect(s.muted).toBe(true);
    expect(s.visualEnabled).toBe(false);
    expect(s.hapticEnabled).toBe(false);
  });
});

describe('tone profile + accent pattern', () => {
  it('defaults to the pitched profile and an accent-on-beat-1 pattern', () => {
    const s = useMetronome.getState();
    expect(s.toneProfile).toBe('pitched');
    expect(s.accentPattern).toEqual(['accent', 'normal', 'normal', 'normal']);
  });

  it('setToneProfile updates the active profile', () => {
    useMetronome.getState().setToneProfile('woodblock');
    expect(useMetronome.getState().toneProfile).toBe('woodblock');
  });

  it('cycleBeatState cycles accent -> normal -> mute -> accent', () => {
    const cycle = (): string | undefined => useMetronome.getState().accentPattern[0];
    expect(cycle()).toBe('accent');
    useMetronome.getState().cycleBeatState(0);
    expect(cycle()).toBe('normal');
    useMetronome.getState().cycleBeatState(0);
    expect(cycle()).toBe('mute');
    useMetronome.getState().cycleBeatState(0);
    expect(cycle()).toBe('accent');
  });

  it('cycleBeatState ignores out-of-range indexes', () => {
    const before = useMetronome.getState().accentPattern;
    useMetronome.getState().cycleBeatState(-1);
    useMetronome.getState().cycleBeatState(99);
    expect(useMetronome.getState().accentPattern).toEqual(before);
  });

  it('setBeatsPerBar extends the pattern with normal beats', () => {
    useMetronome.getState().setBeatsPerBar(6);
    expect(useMetronome.getState().beatsPerBar).toBe(6);
    expect(useMetronome.getState().accentPattern).toEqual([
      'accent', 'normal', 'normal', 'normal', 'normal', 'normal',
    ]);
  });

  it('setBeatsPerBar truncates the pattern while preserving leading entries', () => {
    useMetronome.setState({
      beatsPerBar: 4,
      accentPattern: ['accent', 'mute', 'normal', 'accent'],
    });
    useMetronome.getState().setBeatsPerBar(2);
    expect(useMetronome.getState().beatsPerBar).toBe(2);
    expect(useMetronome.getState().accentPattern).toEqual(['accent', 'mute']);
  });
});
