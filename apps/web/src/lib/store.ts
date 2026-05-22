import { create } from 'zustand';

interface MetronomeState {
  bpm: number;
  beatsPerBar: number;
  isPlaying: boolean;
  currentBeat: number;
  muted: boolean;
  setBpm: (bpm: number) => void;
  setBeatsPerBar: (n: number) => void;
  setPlaying: (playing: boolean) => void;
  setCurrentBeat: (beat: number) => void;
  setMuted: (muted: boolean) => void;
  toggleMuted: () => void;
}

export const useMetronome = create<MetronomeState>((set) => ({
  bpm: 120,
  beatsPerBar: 4,
  isPlaying: false,
  currentBeat: 0,
  muted: false,
  setBpm: (bpm) => set({ bpm: clamp(bpm, 30, 300) }),
  setBeatsPerBar: (beatsPerBar) => set({ beatsPerBar: clamp(beatsPerBar, 1, 12) }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setCurrentBeat: (currentBeat) => set({ currentBeat }),
  setMuted: (muted) => set({ muted }),
  toggleMuted: () => set((s) => ({ muted: !s.muted })),
}));

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
