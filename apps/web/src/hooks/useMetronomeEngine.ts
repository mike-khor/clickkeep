import { useCallback, useEffect, useRef } from 'react';
import {
  getVoice,
  startClick,
  type RunningClick,
  pulse,
} from '@clickkeep/click-engine';
import type { NativeMetronomePlugin } from '@clickkeep/native-metronome';
import { useMetronome } from '../lib/store.js';
import {
  getAudioContext,
  rampMasterGainIn,
  recordBeat,
  recordEngineError,
  resetEngineStats,
  resumeAudioContext,
  silenceScheduledAudio,
} from '../lib/audio.js';
import {
  beatStateAt,
  nextBeatBoundaryPastLead,
  reanchor,
  type Anchor,
} from '../lib/beat-state.js';
import { getNativeMetronome } from '../lib/platform-native-audio.js';
import { useLatestRef } from './useLatestRef.js';
import { useLazyRef } from './useLazyRef.js';

// Must exceed the scheduler's lookahead (100ms) so a tempo change can never
// race a beat that's already been queued for audio playback. 150ms gives a
// safe margin without an audible gap.
const HANDOFF_LOOKAHEAD_MS = 150;

/**
 * Owner of the metronome runtime: the Web Audio scheduler, the iOS native
 * plugin fallback, and every handoff between them. Reads live store values
 * through `useLatestRef` so tempo / signature / pattern edits flow through
 * without an engine restart.
 *
 * Split out of SoloMetronome so that component only concerns itself with
 * rendering. Everything mutable-and-audio lives here.
 */
export function useMetronomeEngine(): void {
  const { bpm, beatsPerBar, isPlaying, tempoMap, setBpm, setCurrentBeat } = useMetronome();

  // Live refs for the scheduler callback: it captures these once and reads
  // through .current so changes take effect on the next scheduled beat
  // without rebinding the callback (which would restart the engine).
  const beatsPerBarRef = useLatestRef(beatsPerBar);
  const hapticEnabledRef = useLatestRef(useMetronome((s) => s.hapticEnabled));
  const toneProfileRef = useLatestRef(useMetronome((s) => s.toneProfile));
  const accentPatternRef = useLatestRef(useMetronome((s) => s.accentPattern));

  const runningRef = useRef<RunningClick | null>(null);
  const anchorRef = useRef<Anchor | null>(null);
  // Native (iOS) metronome handle — computed exactly once. `null` is a legal
  // memoized result (we're in a plain browser), so we use `useLazyRef` and
  // let its own `undefined` sentinel distinguish "not yet looked up" from
  // "confirmed not available".
  const nativeRef = useLazyRef<NativeMetronomePlugin | null>(() => getNativeMetronome());
  // Explicit mode instead of a boolean sprinkled through guards. Every
  // scheduler op reads this to decide "which engine am I talking to?".
  //   idle       — engine not running (isPlaying=false, or we're mid-teardown)
  //   foreground — Web Audio scheduler is the active source
  //   background — native plugin is the active source (iOS only)
  const modeRef = useRef<'idle' | 'foreground' | 'background'>('idle');

  // Stable across renders: only touches refs (all stable) and store.getState().
  // Wrapping in useCallback keeps the effect dep lists honest.
  const startForegroundScheduler = useCallback(
    (anchor: Anchor): RunningClick => {
      const ctx = getAudioContext();
      const tempo = [{ startAt: anchor.startAt, bpm: anchor.bpm, beatsPerBar: anchor.beatsPerBar }];
      return startClick(tempo, {
        audioCtx: ctx,
        // Read the offset from the store on every tick so a fresh ping estimate
        // (every 30 s + burst at connect) auto-corrects clock drift within one tick.
        nowServerMs: () => Date.now() + useMetronome.getState().sessionClockOffsetMs,
        // Closures so a profile or pattern change takes effect on the very next
        // scheduled beat without tearing down and restarting the engine.
        voice: (args) => getVoice(toneProfileRef.current)(args),
        beatStateFor: (beat) => beatStateAt(accentPatternRef.current, beat, beatsPerBarRef.current),
        onBeatScheduled: (beat, audioTime) => {
          recordBeat(beat, audioTime);
          // Schedule UI flash + haptic at the audio time. requestAnimationFrame
          // alignment is approximate; for solo mode this is good enough.
          setTimeout(() => {
            setCurrentBeat(beat);
            if (!hapticEnabledRef.current) return;
            // Haptic follows the user's accent pattern via the SAME helper the
            // scheduler uses — a beat the user muted is silent AND vibration-less.
            const state = beatStateAt(accentPatternRef.current, beat, beatsPerBarRef.current);
            if (state === 'mute') return;
            pulse(state === 'accent' ? 60 : 20);
          }, 0);
        },
      });
    },
    // Refs (accessed via .current) and zustand actions are stable. Empty deps
    // keeps this callback identity stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setCurrentBeat],
  );

  // Play-lifecycle: create/tear down the Web Audio scheduler on play toggle.
  // bpm/beatsPerBar deliberately NOT in deps — rapid slider input would tear
  // down and recreate the scheduler on each change, and each fresh scheduler
  // fires its first beat immediately ("frenzied burst"). Tempo changes flow
  // through the seamless-handoff effect below.
  useEffect(() => {
    if (!isPlaying) {
      runningRef.current?.stop();
      runningRef.current = null;
      anchorRef.current = null;
      modeRef.current = 'idle';
      return;
    }
    // Anchor the tempo to a shared server-clock instant so every tab schedules
    // beats to the same real-world moments even across machines. In group mode,
    // owner and members translate through their own SessionClient-measured
    // offset; solo mode has offset=0.
    const { sessionAnchorMs, sessionClockOffsetMs } = useMetronome.getState();
    const startAt = sessionAnchorMs ?? Date.now() + sessionClockOffsetMs;
    const anchor: Anchor = { startAt, bpm, beatsPerBar };
    anchorRef.current = anchor;
    resetEngineStats();
    modeRef.current = 'foreground';
    // startClick fires its first tick synchronously, so a broken AudioContext
    // throws here on construction. Ticks 2..N run inside setInterval and surface
    // via the window 'error' listener installed in audio.ts.
    try {
      runningRef.current = startForegroundScheduler(anchor);
    } catch (err) {
      recordEngineError(err);
      throw err;
    }
    return () => {
      runningRef.current?.stop();
      runningRef.current = null;
      anchorRef.current = null;
      modeRef.current = 'idle';
    };
    // bpm / beatsPerBar deliberately excluded — see comment above and handoff effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, setCurrentBeat]);

  // Seamless handoff on tempo / signature change while foreground-playing.
  // Anchor the new scheduler to the next natural beat boundary at the OLD
  // tempo (skipping any beat already inside the audio lookahead, to avoid a
  // double-click). From the new scheduler's perspective, that anchor sits at
  // beat 0 in the future — so no instant click fires.
  useEffect(() => {
    if (!isPlaying) return;
    // If native is currently the active audio source, the tempo change is
    // pushed through `native.updateTempo` in a dedicated effect below —
    // starting a Web Audio scheduler now would queue nodes into a suspended
    // AudioContext and then double-fire on resume.
    if (modeRef.current !== 'foreground') return;
    const prev = anchorRef.current;
    if (prev === null) return;
    if (prev.bpm === bpm && prev.beatsPerBar === beatsPerBar) return;

    const now = Date.now() + useMetronome.getState().sessionClockOffsetMs;
    const nextBeatAt = nextBeatBoundaryPastLead(prev, now, HANDOFF_LOOKAHEAD_MS);
    const nextAnchor: Anchor = { startAt: nextBeatAt, bpm, beatsPerBar };
    runningRef.current?.stop();
    anchorRef.current = nextAnchor;
    runningRef.current = startForegroundScheduler(nextAnchor);
  }, [bpm, beatsPerBar, isPlaying, setCurrentBeat]);

  // Native-audio handoff. On iOS (Capacitor shell), Web Audio suspends the
  // moment the WKWebView backgrounds — the AudioContext freezes and any
  // queued events replay in a burst on resume. `UIBackgroundModes = audio`
  // and an `AVAudioSession = .playback` are necessary but not sufficient:
  // the WebView-owned graph still goes to sleep.
  //
  // Solution: on `visibilitychange -> hidden`, stop the Web Audio scheduler
  // entirely and hand the click over to the native AVAudioEngine plugin.
  // On `visible`, stop native, silence any stale audio nodes, ramp gain
  // back in, and start a fresh Web Audio scheduler anchored past the
  // ramp-in point. In an ordinary browser (or an Android Capacitor build)
  // the native handle is null and we simply do nothing on background — the
  // click will pause when the tab is hidden, same as before iOS shipped.
  useEffect(() => {
    if (!isPlaying) return;
    if (typeof document === 'undefined') return;

    const native = nativeRef.current;

    const handoffToNative = async (): Promise<void> => {
      if (native === null) return;
      // Tear down the Web Audio scheduler first — otherwise its queued beats
      // would replay through the master gain on resume.
      runningRef.current?.stop();
      runningRef.current = null;
      // Silence anything already scheduled to the audio thread so it can't
      // resurface when the WebView foregrounds again.
      silenceScheduledAudio();
      const prev = anchorRef.current;
      const bpmForNative = prev?.bpm ?? bpm;
      const beatsForNative = prev?.beatsPerBar ?? beatsPerBar;
      try {
        await native.start({
          bpm: bpmForNative,
          beatsPerBar: beatsForNative,
          accentPattern:
            accentPatternRef.current.length > 0 ? accentPatternRef.current : undefined,
          // Share the wall-clock anchor so native lands its first tick on the
          // true next-beat grid position — otherwise the accent always fires
          // immediately and the perceived measure resets to beat 1.
          anchorEpochMs: prev?.startAt,
        });
        modeRef.current = 'background';
      } catch (err) {
        recordEngineError(err);
      }
    };

    const handoffToWebAudio = async (): Promise<void> => {
      if (native !== null && modeRef.current === 'background') {
        try {
          await native.stop();
        } catch (err) {
          recordEngineError(err);
        }
      }
      // Wake the AudioContext BEFORE ramping / scheduling. On WKWebView
      // after a background cycle, resume() alone leaves the pipeline
      // silent until a real audio op nudges it — see resumeAudioContext.
      await resumeAudioContext();
      const prev = anchorRef.current;
      if (prev === null) {
        modeRef.current = 'idle';
        return;
      }
      // Silence, then ramp master gain back in over the flush window.
      // silenceScheduledAudio returns the earliest wall-clock instant after
      // which fresh beats will be audible — anchor past that.
      const readyAtMs = silenceScheduledAudio();
      rampMasterGainIn();
      const now = Date.now() + useMetronome.getState().sessionClockOffsetMs;
      const leadMs = Math.max(HANDOFF_LOOKAHEAD_MS, readyAtMs - now);
      const nextBeatAt = nextBeatBoundaryPastLead(prev, now, leadMs);
      const nextAnchor: Anchor = { startAt: nextBeatAt, bpm: prev.bpm, beatsPerBar: prev.beatsPerBar };
      anchorRef.current = nextAnchor;
      modeRef.current = 'foreground';
      runningRef.current = startForegroundScheduler(nextAnchor);
    };

    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        void handoffToNative();
      } else if (document.visibilityState === 'visible') {
        void handoffToWebAudio();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    // If the user hits play while the tab is already hidden — rare but
    // possible on iOS if the screen locks the moment they tap play — jump
    // straight into the native engine so audio starts immediately instead
    // of waiting for the next visibilitychange.
    if (document.visibilityState === 'hidden') {
      void handoffToNative();
    }
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      // If the effect is torn down (isPlaying flipped off) while the
      // native engine is still running — e.g. the user hits pause while
      // the app is backgrounded and iOS wakes us just enough to run the
      // React cleanup — make sure we don't leave AVAudioEngine ticking.
      if (native !== null && modeRef.current === 'background') {
        void native.stop().catch((err: unknown) => recordEngineError(err));
        modeRef.current = 'idle';
      }
    };
  }, [isPlaying, setCurrentBeat, bpm, beatsPerBar]);

  // While the native engine is the active audio source, tempo / bar-length /
  // accent-pattern changes need to be pushed through `updateTempo`. The Web
  // Audio seamless-handoff effect above is a no-op because runningRef.current
  // is null. In practice the app is backgrounded when native is active, so
  // most users won't touch the sliders, but Session-mode owners CAN receive
  // a MIDI tempo-map change while their screen is locked; this effect keeps
  // them honest. We also re-anchor onto the NEW grid so `handoffToWebAudio`
  // uses a startAt that is truly beat 0 at the current BPM — otherwise the
  // accent pattern would land on the wrong beats for the rest of the session.
  const accentPattern = useMetronome((s) => s.accentPattern);
  useEffect(() => {
    if (!isPlaying) return;
    const native = nativeRef.current;
    if (native === null) return;
    if (modeRef.current !== 'background') return;
    if (anchorRef.current !== null) {
      const now = Date.now() + useMetronome.getState().sessionClockOffsetMs;
      anchorRef.current = reanchor(anchorRef.current, bpm, beatsPerBar, now);
    }
    void native
      .updateTempo({
        bpm,
        beatsPerBar,
        accentPattern: accentPattern.length > 0 ? accentPattern : undefined,
        anchorEpochMs: anchorRef.current?.startAt,
      })
      .catch((err: unknown) => recordEngineError(err));
  }, [isPlaying, bpm, beatsPerBar, accentPattern]);

  // MIDI tempo-map scheduling: when a tempo map is loaded and the user hits
  // Play, schedule each upcoming BPM change. Each timer fires
  // HANDOFF_LOOKAHEAD_MS before the target time so the seamless-handoff
  // effect above lands the new tempo on the right beat. We pump tempo
  // changes through `setBpm`, which triggers the handoff. Stop or clear
  // cancels every pending timer.
  useEffect(() => {
    if (!isPlaying || tempoMap === null || tempoMap.length === 0) return;
    const startedAt = performance.now();
    const timers: ReturnType<typeof setTimeout>[] = [];
    // The first entry is the starting BPM, already applied by setTempoMap.
    // Skip any entry at timeSec <= 0 — those have already taken effect.
    for (const change of tempoMap) {
      const fireAt = startedAt + change.timeSec * 1000 - HANDOFF_LOOKAHEAD_MS;
      const delay = fireAt - performance.now();
      if (delay <= 0) continue;
      const id = setTimeout(() => {
        setBpm(change.bpm);
      }, delay);
      timers.push(id);
    }
    return () => {
      for (const id of timers) clearTimeout(id);
    };
  }, [isPlaying, tempoMap, setBpm]);
}
