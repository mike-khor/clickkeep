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
  sessionRole: SessionRole;
  setBpm: (bpm: number) => void;
  setBeatsPerBar: (n: number) => void;
  setPlaying: (playing: boolean) => void;
  setCurrentBeat: (beat: number) => void;
  setMuted: (muted: boolean) => void;
  toggleMuted: () => void;
  setSessionRole: (role: SessionRole) => void;
}

export const useMetronome = create<MetronomeState>((set) => ({
  bpm: 120,
  beatsPerBar: 4,
  isPlaying: false,
  currentBeat: 0,
  muted: false,
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
  setSessionRole: (sessionRole) => set({ sessionRole }),
}));

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
