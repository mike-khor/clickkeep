// Tier-1 file: agents can update copy here freely. All user-visible strings live here
// (eventually for i18n; for now just to keep them out of components).

export const COPY = {
  appName: 'ClickKeep',
  tagline: 'A free, universal group metronome',
  solo: {
    title: 'Solo',
    play: 'Play',
    stop: 'Stop',
    tap: 'Tap',
    tapHint: 'Tap to set tempo',
    bpm: 'BPM',
    beatsPerBar: 'Beats per bar',
  },
  session: {
    create: 'Create session',
    join: 'Join session',
    codeLabel: 'Session code',
    codePlaceholder: 'ABCD',
    leave: 'Leave',
    membersOne: 'member',
    membersMany: 'members',
  },
  theme: {
    light: 'Light',
    dark: 'Dark',
    system: 'System',
  },
} as const;
