export { startClick } from './scheduler.js';
export type { RunningClick, SchedulerOptions } from './scheduler.js';
export { pulse, accentPulse, setHapticImpl } from './haptic.js';
export type { HapticImpl } from './haptic.js';
export {
  getVoice,
  pitchedVoice,
  pitchedAltVoice,
  woodblockVoice,
  snapVoice,
  hihatVoice,
  TONE_PROFILES,
} from './voices.js';
export type { BeatState, ToneProfile, Voice, VoiceArgs } from './voices.js';
