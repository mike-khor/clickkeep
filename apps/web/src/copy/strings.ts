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
    mute: 'Mute click',
    unmute: 'Unmute click',
    muted: 'Muted',
    visualOn: 'Hide visual flash',
    visualOff: 'Show visual flash',
    hapticOn: 'Disable haptic',
    hapticOff: 'Enable haptic',
  },
  tempoMap: {
    load: 'Load MIDI',
    clear: 'Clear tempo map',
    loaded: 'Tempo map',
    parseError: 'Could not read MIDI file.',
    empty: 'No tempo changes found in this MIDI.',
  },
  session: {
    create: 'Create session',
    join: 'Join session',
    codeLabel: 'Session code',
    codePlaceholder: 'ABCD',
    leave: 'Leave',
    membersOne: 'member',
    membersMany: 'members',
    memberHint: 'Session owner controls tempo.',
    ownerBadge: 'you are the owner',
  },
  theme: {
    light: 'Light',
    dark: 'Dark',
    system: 'System',
  },
} as const;
