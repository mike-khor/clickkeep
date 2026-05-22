// AGENT_GUARDRAIL: this is the sample-accurate scheduler. Audio glitches and tempo
// drift come from changes here. Edits are Tier 3. Cross-reference Chris Wilson's
// "A Tale of Two Clocks" if you need to refresh the lookahead pattern.

import { beatAtServerTime, isAccentBeat, serverTimeForBeat, type TempoSegment } from '@clickkeep/sync-core';
import { getVoice, pitchedVoice, type BeatState, type ToneProfile, type Voice } from './voices.js';

export interface SchedulerOptions {
  /** How far ahead (sec) to schedule audio events. Bigger = safer; smaller = lower latency. */
  lookaheadSec?: number;
  /** Interval (ms) at which the JS clock wakes to schedule upcoming events. */
  scheduleIntervalMs?: number;
  /** Function returning current server time (ms). Plug your clock-offset estimate in here. */
  nowServerMs: () => number;
  /** Audio context. */
  audioCtx: AudioContext;
  /** Called by the scheduler when each beat is scheduled, for visual / haptic side effects. */
  onBeatScheduled: (beat: number, audioTime: number) => void;
  /**
   * Click tone. Either a profile id (resolved once on start) or a Voice
   * function. Pass a closure (e.g. `(args) => getVoice(ref.current)(args)`)
   * to switch profiles live without restarting the engine. Defaults to 'pitched'.
   */
  voice?: ToneProfile | Voice;
  /**
   * Per-beat state callback. Lets the caller mute / accent specific beats
   * on top of the tempo map's natural downbeat accent. When omitted, beats
   * are 'accent' on segment downbeats and 'normal' elsewhere. Beats with
   * state 'mute' skip audio output entirely, but onBeatScheduled still
   * fires so the visual / haptic side effects continue.
   */
  beatStateFor?: (beat: number) => BeatState;
}

export interface RunningClick {
  /** Stop scheduling further beats. Already-scheduled audio nodes play to completion. */
  stop: () => void;
}

const DEFAULTS = {
  lookaheadSec: 0.1,
  scheduleIntervalMs: 25,
};

/**
 * Start clicking on a tempo map. Returns a handle to stop.
 *
 * The scheduler:
 *   1. Wakes every `scheduleIntervalMs` (default 25ms).
 *   2. Computes the current beat from the server clock.
 *   3. Schedules every beat whose audio time falls within `lookaheadSec`.
 *   4. Tracks the last-scheduled beat to avoid double-firing.
 *
 * Audio scheduling uses AudioContext.currentTime + (server→client offset of the next beat).
 * Because Web Audio's clock runs independently of setTimeout jitter, beats land precisely.
 */
export function startClick(tempo: TempoSegment[], opts: SchedulerOptions): RunningClick {
  const lookaheadSec = opts.lookaheadSec ?? DEFAULTS.lookaheadSec;
  const intervalMs = opts.scheduleIntervalMs ?? DEFAULTS.scheduleIntervalMs;
  const { audioCtx, nowServerMs, onBeatScheduled } = opts;
  const voice = resolveVoice(opts.voice);
  const beatStateFor =
    opts.beatStateFor ?? ((beat: number): BeatState => (isAccentBeat(tempo, beat) ? 'accent' : 'normal'));

  // Where to start: ceiling of current beat (don't fire a beat we've already passed).
  const startBeat = Math.ceil(beatAtServerTime(tempo, nowServerMs()).beat);
  let nextBeat = startBeat;

  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = (): void => {
    if (stopped) return;
    const serverNow = nowServerMs();
    const horizonServer = serverNow + lookaheadSec * 1000;

    // Schedule every beat whose server time is within the lookahead window.
    while (!stopped) {
      const beatServerTime = serverTimeForBeat(tempo, nextBeat);
      if (beatServerTime > horizonServer) break;
      // Convert server time to AudioContext time. The AudioContext clock is
      // monotonic in seconds; serverNow is ms-since-epoch on the server clock.
      // Their delta gives us audioCtx time for the beat.
      const audioTimeForBeat = audioCtx.currentTime + (beatServerTime - serverNow) / 1000;
      if (audioTimeForBeat >= audioCtx.currentTime) {
        const state = beatStateFor(nextBeat);
        // Mute = no audio, but visual + haptic still fire via onBeatScheduled.
        if (state !== 'mute') {
          voice({ audioCtx, atTime: audioTimeForBeat, state });
        }
        onBeatScheduled(nextBeat, audioTimeForBeat);
      }
      nextBeat += 1;
    }
  };

  // Fire once immediately so the user-visible first beat lands fast,
  // then on interval thereafter.
  tick();
  timer = setInterval(tick, intervalMs);

  return {
    stop: () => {
      stopped = true;
      if (timer !== null) clearInterval(timer);
    },
  };
}

function resolveVoice(voice: SchedulerOptions['voice']): Voice {
  if (voice === undefined) return pitchedVoice;
  if (typeof voice === 'function') return voice;
  return getVoice(voice);
}
