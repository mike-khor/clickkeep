import { create } from 'zustand';
import type { TempoMap } from './midi-tempo.js';
import {
  getStoredHapticEnabled,
  getStoredMuted,
  getStoredVisualEnabled,
  setStoredHapticEnabled,
  setStoredMuted,
  setStoredVisualEnabled,
} from './output-prefs.js';

/**
 * 'solo'   — no session connected; local Play controls work as today.
 * 'owner'  — user created the session; their controls drive everyone.
 * 'member' — user joined someone else's session; controls are read-only.
 *
 * The server (workers/session/src/session-do.ts) already rejects set-state /
 * play / pause from non-owners. This flag is purely for UX — disabled controls
 * so a member can't even attempt a desync by hitting their local Play.
 */
export type SessionRole = 'solo' | 'owner' | 'member';

interface MetronomeState {
  bpm: number;
  beatsPerBar: number;
  isPlaying: boolean;
  currentBeat: number;
  muted: boolean;
  // Independent per-output toggles. All default ON; each is local-only (no
  // session traffic) so members can silence their device without affecting
  // anyone else. `muted` covers audio for backwards-compat; visual/haptic
  // mirror it for the other two output channels.
  visualEnabled: boolean;
  hapticEnabled: boolean;
  sessionRole: SessionRole;
  // Optional MIDI-loaded tempo map. When set, solo playback applies these
  // BPM changes at their `timeSec` offsets from the moment Play was pressed.
  // Group sync of tempo maps is out of scope for this PR.
  tempoMap: TempoMap | null;
  tempoMapName: string | null;
  setBpm: (bpm: number) => void;
  setBeatsPerBar: (n: number) => void;
  setPlaying: (playing: boolean) => void;
  setCurrentBeat: (beat: number) => void;
  setMuted: (muted: boolean) => void;
  toggleMuted: () => void;
  setVisualEnabled: (enabled: boolean) => void;
  toggleVisualEnabled: () => void;
  setHapticEnabled: (enabled: boolean) => void;
  toggleHapticEnabled: () => void;
  setSessionRole: (role: SessionRole) => void;
  setTempoMap: (map: TempoMap | null, name?: string | null) => void;
  clearTempoMap: () => void;
}

export const useMetronome = create<MetronomeState>((set) => ({
  bpm: 120,
  beatsPerBar: 4,
  isPlaying: false,
  currentBeat: 0,
  muted: getStoredMuted(),
  visualEnabled: getStoredVisualEnabled(),
  hapticEnabled: getStoredHapticEnabled(),
  sessionRole: 'solo',
  tempoMap: null,
  tempoMapName: null,
  // Floats are allowed (e.g. 120.5). Integer callers (slider, tap-tempo) still work
  // because clamp is a pure numeric operation. Display layers should call .toFixed(1).
  setBpm: (bpm) => {
    if (!Number.isFinite(bpm)) return;
    set({ bpm: clamp(bpm, 30, 300) });
  },
  setBeatsPerBar: (beatsPerBar) => set({ beatsPerBar: clamp(beatsPerBar, 1, 12) }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setCurrentBeat: (currentBeat) => set({ currentBeat }),
  setMuted: (muted) => {
    setStoredMuted(muted);
    set({ muted });
  },
  toggleMuted: () =>
    set((s) => {
      const muted = !s.muted;
      setStoredMuted(muted);
      return { muted };
    }),
  setVisualEnabled: (visualEnabled) => {
    setStoredVisualEnabled(visualEnabled);
    set({ visualEnabled });
  },
  toggleVisualEnabled: () =>
    set((s) => {
      const visualEnabled = !s.visualEnabled;
      setStoredVisualEnabled(visualEnabled);
      return { visualEnabled };
    }),
  setHapticEnabled: (hapticEnabled) => {
    setStoredHapticEnabled(hapticEnabled);
    set({ hapticEnabled });
  },
  toggleHapticEnabled: () =>
    set((s) => {
      const hapticEnabled = !s.hapticEnabled;
      setStoredHapticEnabled(hapticEnabled);
      return { hapticEnabled };
    }),
  setSessionRole: (sessionRole) => set({ sessionRole }),
  // Snap the active BPM to the first entry so the UI doesn't show a stale
  // manual value sitting above a freshly-loaded timeline.
  setTempoMap: (tempoMap, name = null) => {
    if (tempoMap === null || tempoMap.length === 0) {
      set({ tempoMap: null, tempoMapName: null });
      return;
    }
    const first = tempoMap[0];
    if (first === undefined) {
      set({ tempoMap: null, tempoMapName: null });
      return;
    }
    set({ tempoMap, tempoMapName: name, bpm: clamp(first.bpm, 30, 300) });
  },
  clearTempoMap: () => set({ tempoMap: null, tempoMapName: null }),
}));

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
