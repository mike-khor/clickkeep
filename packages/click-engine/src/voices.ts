/**
 * Click voices: Web-Audio-only synthesis (no samples, no deps).
 *
 * Each voice is a pure function that wires a one-shot graph onto the given
 * AudioContext and starts it at `atTime`. The scheduler invokes voices for
 * every non-mute beat. Voices are responsible for their own envelope so the
 * scheduler doesn't have to know whether a tone is pitched or noise.
 *
 * Accent state arrives via `args.state` so each voice can pick a louder /
 * brighter variant for downbeats without the scheduler hardcoding pitches.
 */

export type BeatState = 'accent' | 'normal' | 'mute';

export type ToneProfile = 'pitched' | 'pitched-alt' | 'woodblock' | 'snap' | 'hi-hat';

export const TONE_PROFILES: readonly ToneProfile[] = [
  'pitched',
  'pitched-alt',
  'woodblock',
  'snap',
  'hi-hat',
] as const;

export interface VoiceArgs {
  audioCtx: AudioContext;
  atTime: number;
  state: BeatState;
}

export type Voice = (args: VoiceArgs) => void;

/** Default — the original ClickKeep tone. Square wave at two pitches. */
export const pitchedVoice: Voice = ({ audioCtx, atTime, state }) => {
  const isAccent = state === 'accent';
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'square';
  osc.frequency.value = isAccent ? 1500 : 1000;
  gain.gain.setValueAtTime(0, atTime);
  gain.gain.linearRampToValueAtTime(isAccent ? 0.35 : 0.22, atTime + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.0001, atTime + 0.06);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(atTime);
  osc.stop(atTime + 0.07);
};

/** Triangle pair — softer, lower variant. */
export const pitchedAltVoice: Voice = ({ audioCtx, atTime, state }) => {
  const isAccent = state === 'accent';
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = isAccent ? 880 : 660;
  gain.gain.setValueAtTime(0, atTime);
  gain.gain.linearRampToValueAtTime(isAccent ? 0.4 : 0.26, atTime + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.0001, atTime + 0.08);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(atTime);
  osc.stop(atTime + 0.09);
};

/** Woodblock — band-passed noise burst centered on a wood-like frequency. */
export const woodblockVoice: Voice = ({ audioCtx, atTime, state }) => {
  const isAccent = state === 'accent';
  const src = createNoiseSource(audioCtx, 0.06);
  const bp = audioCtx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = isAccent ? 1200 : 900;
  bp.Q.value = 8;
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0, atTime);
  gain.gain.linearRampToValueAtTime(isAccent ? 1.0 : 0.8, atTime + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.0001, atTime + 0.05);
  src.connect(bp).connect(gain).connect(audioCtx.destination);
  src.start(atTime);
  src.stop(atTime + 0.06);
};

/** Snap — sharp, brief band-passed noise in the upper-mid range. */
export const snapVoice: Voice = ({ audioCtx, atTime, state }) => {
  const isAccent = state === 'accent';
  const src = createNoiseSource(audioCtx, 0.04);
  const bp = audioCtx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = isAccent ? 6000 : 4500;
  bp.Q.value = 4;
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0, atTime);
  gain.gain.linearRampToValueAtTime(isAccent ? 0.95 : 0.7, atTime + 0.0005);
  gain.gain.exponentialRampToValueAtTime(0.0001, atTime + 0.03);
  src.connect(bp).connect(gain).connect(audioCtx.destination);
  src.start(atTime);
  src.stop(atTime + 0.04);
};

/** Hi-hat — high-pass-filtered white noise burst. */
export const hihatVoice: Voice = ({ audioCtx, atTime, state }) => {
  const isAccent = state === 'accent';
  const src = createNoiseSource(audioCtx, 0.05);
  const hp = audioCtx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7000;
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0, atTime);
  gain.gain.linearRampToValueAtTime(isAccent ? 0.35 : 0.22, atTime + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.0001, atTime + 0.04);
  src.connect(hp).connect(gain).connect(audioCtx.destination);
  src.start(atTime);
  src.stop(atTime + 0.05);
};

const VOICE_REGISTRY: Record<ToneProfile, Voice> = {
  pitched: pitchedVoice,
  'pitched-alt': pitchedAltVoice,
  woodblock: woodblockVoice,
  snap: snapVoice,
  'hi-hat': hihatVoice,
};

/** Resolve a profile id to its voice. Unknown ids fall back to the default. */
export function getVoice(profile: ToneProfile): Voice {
  return VOICE_REGISTRY[profile] ?? pitchedVoice;
}

/**
 * Build a short white-noise buffer source. Size = duration * sampleRate;
 * one channel is enough — the listener routes through destination's mix.
 */
function createNoiseSource(audioCtx: AudioContext, durationSec: number): AudioBufferSourceNode {
  const sampleRate = audioCtx.sampleRate;
  const frameCount = Math.max(1, Math.floor(durationSec * sampleRate));
  const buffer = audioCtx.createBuffer(1, frameCount, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frameCount; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  return src;
}
