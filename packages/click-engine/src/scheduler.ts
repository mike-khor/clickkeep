// AGENT_GUARDRAIL: this is the sample-accurate scheduler. Audio glitches and tempo
// drift come from changes here. Edits are Tier 3. Cross-reference Chris Wilson's
// "A Tale of Two Clocks" if you need to refresh the lookahead pattern.

import { beatAtServerTime, isAccentBeat, serverTimeForBeat, type TempoSegment } from '@clickkeep/sync-core';

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
        // Accent on the downbeat of whichever tempo segment this beat lives in.
        // Counting from the start of the current segment keeps the audio accent
        // aligned with the user-selected beatsPerBar (the visual flash in
        // BeatIndicator does the equivalent via React state). Previously this
        // was hardcoded to `nextBeat % 4 === 0`, which drifted out of sync
        // whenever beatsPerBar was anything other than 4.
        playClick(audioCtx, audioTimeForBeat, isAccentBeat(tempo, nextBeat));
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

/**
 * Single click sound. Short tone, distinct accent on downbeats.
 * Synthesized so we have zero asset load and consistent latency.
 */
function playClick(ctx: AudioContext, atTime: number, isAccent: boolean): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = isAccent ? 1500 : 1000;
  // Short envelope: ramp up in 1ms, decay over 60ms. Avoids click-pop.
  gain.gain.setValueAtTime(0, atTime);
  gain.gain.linearRampToValueAtTime(isAccent ? 0.35 : 0.22, atTime + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.0001, atTime + 0.06);
  osc.connect(gain).connect(ctx.destination);
  osc.start(atTime);
  osc.stop(atTime + 0.07);
}
