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
