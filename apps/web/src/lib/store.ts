import { create } from 'zustand';

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
}

export const useMetronome = create<MetronomeState>((set) => ({
  bpm: 120,
  beatsPerBar: 4,
  isPlaying: false,
  currentBeat: 0,
  muted: false,
  visualEnabled: true,
  hapticEnabled: true,
  sessionRole: 'solo',
  // Floats are allowed (e.g. 120.5). Integer callers (slider, tap-tempo) still work
  // because clamp is a pure numeric operation. Display layers should call .toFixed(1).
  setBpm: (bpm) => {
    if (!Number.isFinite(bpm)) return;
    set({ bpm: clamp(bpm, 30, 300) });
  },
  setBeatsPerBar: (beatsPerBar) => set({ beatsPerBar: clamp(beatsPerBar, 1, 12) }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setCurrentBeat: (currentBeat) => set({ currentBeat }),
  setMuted: (muted) => set({ muted }),
  toggleMuted: () => set((s) => ({ muted: !s.muted })),
  setVisualEnabled: (visualEnabled) => set({ visualEnabled }),
  toggleVisualEnabled: () => set((s) => ({ visualEnabled: !s.visualEnabled })),
  setHapticEnabled: (hapticEnabled) => set({ hapticEnabled }),
  toggleHapticEnabled: () => set((s) => ({ hapticEnabled: !s.hapticEnabled })),
  setSessionRole: (sessionRole) => set({ sessionRole }),
}));

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
