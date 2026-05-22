import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMetronome } from './store.js';

// Zustand stores are singletons. Reset to defaults before each test so
// assertions don't leak between cases. Using setState (not mocking) per
// the grug rule: avoid mocking except at coarse-grained boundaries.
//
// IMPORTANT: keep this as raw setState — do NOT switch to setMuted /
// setVisualEnabled / setHapticEnabled. The action setters now write to
// localStorage, so calling them in beforeEach would silently overwrite
// what each persistence test is trying to assert.
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

describe('output-mode toggle persistence', () => {
  // Vitest runs in node (no jsdom), so localStorage is undefined by default.
  // Stub it per-test so the setters' writeBool path actually executes.
  let store: Record<string, string>;
  beforeEach(() => {
    store = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        store = {};
      },
      key: () => null,
      length: 0,
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('toggleMuted persists to localStorage', () => {
    useMetronome.getState().toggleMuted();
    expect(store['clickkeep:muted']).toBe('1');
    useMetronome.getState().toggleMuted();
    expect(store['clickkeep:muted']).toBe('0');
  });

  it('toggleVisualEnabled persists to localStorage', () => {
    useMetronome.getState().toggleVisualEnabled();
    expect(store['clickkeep:visual-enabled']).toBe('0');
    useMetronome.getState().toggleVisualEnabled();
    expect(store['clickkeep:visual-enabled']).toBe('1');
  });

  it('toggleHapticEnabled persists to localStorage', () => {
    useMetronome.getState().toggleHapticEnabled();
    expect(store['clickkeep:haptic-enabled']).toBe('0');
    useMetronome.getState().toggleHapticEnabled();
    expect(store['clickkeep:haptic-enabled']).toBe('1');
  });

  it('explicit setters also persist', () => {
    useMetronome.getState().setMuted(true);
    useMetronome.getState().setVisualEnabled(false);
    useMetronome.getState().setHapticEnabled(false);
    expect(store['clickkeep:muted']).toBe('1');
    expect(store['clickkeep:visual-enabled']).toBe('0');
    expect(store['clickkeep:haptic-enabled']).toBe('0');
  });
});
