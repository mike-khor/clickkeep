#!/usr/bin/env node
/**
 * Generate accent.wav and normal.wav for the native metronome plugin.
 *
 * The tones mirror the `pitchedVoice` in packages/click-engine/src/voices.ts
 * so the sound the user hears in the foreground (Web Audio, oscillator-based)
 * and in the background (native, buffer-based) is as close as possible.
 *
 * Format: 16-bit PCM, 44.1 kHz, mono. Envelope: 0 -> peak linear over 1 ms,
 * then exponential decay to 0.0001 by 60 ms. Total duration ~70 ms.
 *
 * Stdlib only — no npm deps — so the script is committable and re-runnable
 * from a clean checkout with just `node`.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'ios', 'Plugin');
mkdirSync(outDir, { recursive: true });

const SAMPLE_RATE = 44100;
const TOTAL_SEC = 0.07;
const ATTACK_SEC = 0.001;
const DECAY_END_SEC = 0.06;
const FLOOR = 0.0001;

/** Square wave value in [-1, 1] at time `t` for frequency `freq`. */
function square(t, freq) {
  const cycle = (t * freq) % 1;
  return cycle < 0.5 ? 1 : -1;
}

/**
 * Generate a Float32Array of samples for a pitched click.
 *
 * @param {number} freq - Hz
 * @param {number} peak - envelope peak in [0, 1]
 */
function synth(freq, peak) {
  const frames = Math.floor(SAMPLE_RATE * TOTAL_SEC);
  const out = new Float32Array(frames);
  const decayDur = DECAY_END_SEC - ATTACK_SEC;
  // Solve peak * r^decayDur = FLOOR  =>  r = (FLOOR/peak)^(1/decayDur)
  // Evaluate as peak * (FLOOR/peak)^((t - attack) / decayDur).
  const decayRatio = FLOOR / peak;
  for (let i = 0; i < frames; i++) {
    const t = i / SAMPLE_RATE;
    let env;
    if (t < ATTACK_SEC) {
      env = (t / ATTACK_SEC) * peak;
    } else if (t < DECAY_END_SEC) {
      const decayT = (t - ATTACK_SEC) / decayDur;
      env = peak * Math.pow(decayRatio, decayT);
    } else {
      env = 0;
    }
    out[i] = square(t, freq) * env;
  }
  return out;
}

/**
 * Write a mono 16-bit PCM WAV file at `path` from a Float32Array of samples
 * in the range [-1, 1].
 */
function writeWav(path, samples) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const byteRate = SAMPLE_RATE * numChannels * bytesPerSample;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = samples.length * bytesPerSample;
  const buf = Buffer.alloc(44 + dataSize);

  let o = 0;
  buf.write('RIFF', o); o += 4;
  buf.writeUInt32LE(36 + dataSize, o); o += 4;
  buf.write('WAVE', o); o += 4;
  buf.write('fmt ', o); o += 4;
  buf.writeUInt32LE(16, o); o += 4; // PCM fmt chunk size
  buf.writeUInt16LE(1, o); o += 2; // audio format: PCM
  buf.writeUInt16LE(numChannels, o); o += 2;
  buf.writeUInt32LE(SAMPLE_RATE, o); o += 4;
  buf.writeUInt32LE(byteRate, o); o += 4;
  buf.writeUInt16LE(blockAlign, o); o += 2;
  buf.writeUInt16LE(bitsPerSample, o); o += 2;
  buf.write('data', o); o += 4;
  buf.writeUInt32LE(dataSize, o); o += 4;

  for (let i = 0; i < samples.length; i++) {
    const clipped = Math.max(-1, Math.min(1, samples[i]));
    const int = Math.round(clipped * 32767);
    buf.writeInt16LE(int, 44 + i * bytesPerSample);
  }
  writeFileSync(path, buf);
}

// Match voices.pitched: accent 1500 Hz peak 0.35, normal 1000 Hz peak 0.22.
writeWav(join(outDir, 'accent.wav'), synth(1500, 0.35));
writeWav(join(outDir, 'normal.wav'), synth(1000, 0.22));
console.log('wrote', join(outDir, 'accent.wav'));
console.log('wrote', join(outDir, 'normal.wav'));
