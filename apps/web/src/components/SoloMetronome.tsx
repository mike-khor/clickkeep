import { useEffect, useRef, useState } from 'react';
import {
  getVoice,
  startClick,
  type BeatState,
  type RunningClick,
  type ToneProfile,
  pulse,
} from '@clickkeep/click-engine';
import { useMetronome } from '../lib/store.js';
import {
  FLUSH_RESTORE_DELAY_MS,
  flushAudioQueue,
  getAudioContext,
  recordBeat,
  recordEngineError,
  resetEngineStats,
  resumeAudioContext,
} from '../lib/audio.js';
import { COPY } from '../copy/strings.js';
import { getNativeMetronome, type NativeMetronomeHandle } from '../lib/platform-native-audio.js';
import { BeatIndicator } from './BeatIndicator.js';
import { TapButton } from './TapButton.js';
import { OutputToggles } from './OutputToggles.js';
import { PlayCircle } from './PlayCircle.js';
import { MidiSheet } from './MidiSheet.js';
import { ToneProfileSelector } from './ToneProfileSelector.js';

// Must exceed the scheduler's lookahead (100ms) so a tempo change can never
// race a beat that's already been queued for audio playback. 150ms gives a
// safe margin without an audible gap.
const HANDOFF_LOOKAHEAD_MS = 150;

// Foreground: tight lookahead + fast interval = low latency for tempo edits.
// Matches the scheduler's own defaults; also what HANDOFF_LOOKAHEAD_MS above
// is sized against.
const FOREGROUND_OPTS = { lookaheadSec: 0.1, scheduleIntervalMs: 25 } as const;
// Safety margin over FLUSH_RESTORE_DELAY_MS so the new scheduler's first
// beat lands after master gain has finished ramping back up.
const RESUME_ANCHOR_LEAD_MS = FLUSH_RESTORE_DELAY_MS + 60;

interface Anchor {
  startAt: number;
  bpm: number;
  beatsPerBar: number;
}

interface SchedulerTuning {
  lookaheadSec: number;
  scheduleIntervalMs: number;
}

export function SoloMetronome(): JSX.Element {
  const {
    bpm,
    beatsPerBar,
    isPlaying,
    currentBeat,
    sessionRole,
    tempoMap,
    setBpm,
    setBeatsPerBar,
    setPlaying,
    setCurrentBeat,
  } = useMetronome();
  const runningRef = useRef<RunningClick | null>(null);
  const anchorRef = useRef<Anchor | null>(null);
  // Track which tuning the currently-running scheduler was started with so the
  // seamless-handoff effects (tempo change, signature change) can re-start with
  // the same tuning even after a visibility flip.
  const tuningRef = useRef<SchedulerTuning>(FOREGROUND_OPTS);
  // Read latest beatsPerBar inside the scheduler callback without rebinding it,
  // so signature changes also flow through without restarting the engine.
  const beatsPerBarRef = useRef(beatsPerBar);
  beatsPerBarRef.current = beatsPerBar;
  // Same pattern for haptic toggle: gate the pulse() call from inside the
  // scheduler callback without forcing an engine restart on every flip.
  const hapticEnabled = useMetronome((s) => s.hapticEnabled);
  const hapticEnabledRef = useRef(hapticEnabled);
  hapticEnabledRef.current = hapticEnabled;
  // Voice + accent pattern as refs so changes flow through without a restart.
  const toneProfile = useMetronome((s) => s.toneProfile);
  const toneProfileRef = useRef(toneProfile);
  toneProfileRef.current = toneProfile;
  const accentPattern = useMetronome((s) => s.accentPattern);
  const accentPatternRef = useRef(accentPattern);
  accentPatternRef.current = accentPattern;
  // Native (iOS) metronome handle + whether it's currently the active audio
  // source. Hoisted onto the component so BOTH the visibility-handoff
  // effect and the tempo/pattern effects can see it: when the app is
  // backgrounded the Web Audio scheduler is torn down, so tempo changes
  // must be routed through `native.updateTempo` instead of the seamless
  // handoff. In a browser or non-iOS shell `nativeRef.current` is null
  // and every native call is skipped.
  const nativeRef = useRef<NativeMetronomeHandle | null>(null);
  if (nativeRef.current === null) {
    nativeRef.current = getNativeMetronome();
  }
  const nativeActiveRef = useRef(false);

  // Members listen, they don't drive: lock every tempo / playback affordance.
  // The Tier-3 worker rejects set-state/play/pause from non-owners; this is the
  // UX half of the same invariant so members never even attempt a desync. The
  // owner's incoming state (applied in SessionPanel) now drives `isPlaying`
  // for members, so a member's engine starts/stops in lock-step with the
  // owner — no separate "stop on join" effect needed.
  const isMember = sessionRole === 'member';

  // Local editing buffer for the typed BPM input. We keep a string so users can
  // freely type "12", "120.", "120.5", etc. without us snapping mid-keystroke.
  // `null` means "not editing — render bpm.toFixed(1)".
  const [bpmDraft, setBpmDraft] = useState<string | null>(null);
  const bpmInputRef = useRef<HTMLInputElement | null>(null);

  const commitBpmDraft = (): void => {
    if (bpmDraft === null) return;
    const trimmed = bpmDraft.trim();
    if (trimmed === '') {
      // Empty input reverts to the last valid value.
      setBpmDraft(null);
      return;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      // store.setBpm clamps to [30, 300].
      setBpm(parsed);
    }
    setBpmDraft(null);
  };

  const cancelBpmDraft = (): void => {
    setBpmDraft(null);
    bpmInputRef.current?.blur();
  };

  // Spacebar toggles play/pause unless the user is editing text or holding
  // modifiers (so we don't fight browser shortcuts or eat a literal space in
  // the BPM input). Members can't toggle; let Space scroll the page as usual.
  useEffect(() => {
    if (isMember) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.code !== 'Space') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? '';
      // Don't hijack Space when the user is interacting with a form control or
      // a focusable button — let the browser deliver the default action so
      // tap/leave/etc. still work via keyboard.
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        tag === 'BUTTON' ||
        target?.isContentEditable === true
      ) {
        return;
      }
      e.preventDefault();
      setPlaying(!isPlaying);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isPlaying, isMember, setPlaying]);

  // Start / stop the click engine on play toggle. We intentionally do NOT list
  // bpm or beatsPerBar in this effect's deps: rapid slider input would tear
  // down and recreate the scheduler on each change, and each fresh scheduler
  // fires its first beat immediately ("frenzied burst"). Tempo changes are
  // handled by the seamless-handoff effect below.
  useEffect(() => {
    if (!isPlaying) {
      runningRef.current?.stop();
      runningRef.current = null;
      anchorRef.current = null;
      return;
    }
    const ctx = getAudioContext();
    // Anchor the tempo to a shared server-clock instant so every tab schedules
    // beats to the same real-world moments even across machines. In group mode,
    // owner and members translate through their own SessionClient-measured
    // offset; solo mode has offset=0. Any beats already in the past get skipped
    // inside the scheduler's audioTime guard.
    const { sessionAnchorMs, sessionClockOffsetMs } = useMetronome.getState();
    const startAt = sessionAnchorMs ?? Date.now() + sessionClockOffsetMs;
    const anchor: Anchor = { startAt, bpm, beatsPerBar };
    anchorRef.current = anchor;
    resetEngineStats();
    // startClick fires its first tick synchronously, so a broken AudioContext
    // throws here on construction. Ticks 2..N run inside setInterval and surface
    // via the window 'error' listener installed in audio.ts — both paths feed
    // the same recentErrors buffer.
    // Always start on FOREGROUND_OPTS. If the tab is already hidden the
    // visibility-handoff effect below will immediately swap to the native
    // engine (on iOS) or leave Web Audio to suspend (in a browser).
    tuningRef.current = FOREGROUND_OPTS;
    try {
      runningRef.current = startScheduler(
        ctx,
        anchor,
        setCurrentBeat,
        beatsPerBarRef,
        hapticEnabledRef,
        toneProfileRef,
        accentPatternRef,
        FOREGROUND_OPTS,
      );
    } catch (err) {
      recordEngineError(err);
      throw err;
    }
    return () => {
      runningRef.current?.stop();
      runningRef.current = null;
      anchorRef.current = null;
    };
    // bpm / beatsPerBar deliberately excluded — see comment above and handoff effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, setCurrentBeat]);

  // Seamless handoff on tempo / signature change while playing. Anchor the new
  // scheduler to the next natural beat boundary at the OLD tempo (skipping any
  // beat that's already inside the audio lookahead, to avoid a double-click).
  // From the new scheduler's perspective, that anchor is "beat 0 at startAt",
  // which sits in the future — so no instant click fires.
  useEffect(() => {
    if (!isPlaying) return;
    // If native is currently the active audio source, the tempo change is
    // pushed through `native.updateTempo` in a dedicated effect below —
    // starting a Web Audio scheduler now would queue nodes into a suspended
    // AudioContext and then double-fire on resume.
    if (nativeActiveRef.current) return;
    const prev = anchorRef.current;
    if (prev === null) return;
    if (prev.bpm === bpm && prev.beatsPerBar === beatsPerBar) return;

    const now = Date.now() + useMetronome.getState().sessionClockOffsetMs;
    const oldPeriodMs = 60_000 / prev.bpm;
    // Time of the next beat boundary at the old tempo.
    const elapsed = now - prev.startAt;
    const beatsElapsed = Math.max(0, elapsed / oldPeriodMs);
    let nextBeatAt = prev.startAt + Math.ceil(beatsElapsed) * oldPeriodMs;
    // Push past any beat already in the audio lookahead window.
    while (nextBeatAt - now < HANDOFF_LOOKAHEAD_MS) nextBeatAt += oldPeriodMs;

    const ctx = getAudioContext();
    const nextAnchor: Anchor = { startAt: nextBeatAt, bpm, beatsPerBar };
    runningRef.current?.stop();
    anchorRef.current = nextAnchor;
    runningRef.current = startScheduler(
      ctx,
      nextAnchor,
      setCurrentBeat,
      beatsPerBarRef,
      hapticEnabledRef,
      toneProfileRef,
      accentPatternRef,
      tuningRef.current,
    );
  }, [bpm, beatsPerBar, isPlaying, setCurrentBeat]);

  // Native-audio handoff. On iOS (Capacitor shell), Web Audio suspends the
  // moment the WKWebView backgrounds — the AudioContext freezes and any
  // queued events replay in a burst on resume. `UIBackgroundModes = audio`
  // and an `AVAudioSession = .playback` are necessary but not sufficient:
  // the WebView-owned graph still goes to sleep.
  //
  // Solution: on `visibilitychange -> hidden`, stop the Web Audio scheduler
  // entirely and hand the click over to the native AVAudioEngine plugin.
  // On `visible`, stop native, flush any silenced audio nodes, and start
  // a fresh Web Audio scheduler anchored just past the master-gain restore
  // point. In an ordinary browser (or an Android Capacitor build) the
  // native handle is null and we simply do nothing on background — the
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
      flushAudioQueue();
      const prev = anchorRef.current;
      const bpmForNative = prev?.bpm ?? bpm;
      const beatsForNative = prev?.beatsPerBar ?? beatsPerBar;
      try {
        await native.start({
          bpm: bpmForNative,
          beatsPerBar: beatsForNative,
          accentPattern: accentPatternRef.current.length > 0 ? accentPatternRef.current : undefined,
          // Share the wall-clock anchor so native lands its first tick on the
          // true next-beat grid position — otherwise the accent always fires
          // immediately and the perceived measure resets to beat 1.
          anchorEpochMs: prev?.startAt,
        });
        nativeActiveRef.current = true;
      } catch (err) {
        recordEngineError(err);
      }
    };

    const handoffToWebAudio = async (): Promise<void> => {
      if (native !== null && nativeActiveRef.current) {
        try {
          await native.stop();
        } catch (err) {
          recordEngineError(err);
        }
        nativeActiveRef.current = false;
      }
      // Wake the AudioContext BEFORE flushing / scheduling. On WKWebView
      // after a background cycle, resume() alone leaves the pipeline
      // silent until a real audio op nudges it — see resumeAudioContext.
      await resumeAudioContext();
      // Flush anything the Web Audio graph might have queued while hidden,
      // then anchor the fresh scheduler past the master-gain restore point.
      const prev = anchorRef.current;
      if (prev === null) return;
      flushAudioQueue();
      const now = Date.now() + useMetronome.getState().sessionClockOffsetMs;
      const periodMs = 60_000 / prev.bpm;
      const elapsed = now - prev.startAt;
      const beatsElapsed = Math.max(0, elapsed / periodMs);
      let nextBeatAt = prev.startAt + Math.ceil(beatsElapsed) * periodMs;
      while (nextBeatAt - now < RESUME_ANCHOR_LEAD_MS) nextBeatAt += periodMs;

      const ctx = getAudioContext();
      const nextAnchor: Anchor = { startAt: nextBeatAt, bpm: prev.bpm, beatsPerBar: prev.beatsPerBar };
      anchorRef.current = nextAnchor;
      tuningRef.current = FOREGROUND_OPTS;
      runningRef.current = startScheduler(
        ctx,
        nextAnchor,
        setCurrentBeat,
        beatsPerBarRef,
        hapticEnabledRef,
        toneProfileRef,
        accentPatternRef,
        FOREGROUND_OPTS,
      );
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
      if (native !== null && nativeActiveRef.current) {
        void native.stop().catch((err: unknown) => recordEngineError(err));
        nativeActiveRef.current = false;
      }
    };
  }, [isPlaying, setCurrentBeat, bpm, beatsPerBar]);

  // While the native engine is the active audio source, tempo / bar-length /
  // accent-pattern changes need to be pushed through `updateTempo` — the
  // Web Audio seamless-handoff effect above is a no-op because
  // `runningRef.current` is null. In practice the app is backgrounded when
  // native is active, so most users won't touch the sliders, but Session-
  // mode owners CAN receive a MIDI tempo-map change while their screen
  // is locked; this effect keeps them honest.
  useEffect(() => {
    if (!isPlaying) return;
    const native = nativeRef.current;
    if (native === null) return;
    if (!nativeActiveRef.current) return;
    void native
      .updateTempo({
        bpm,
        beatsPerBar,
        accentPattern: accentPattern.length > 0 ? accentPattern : undefined,
        anchorEpochMs: anchorRef.current?.startAt,
      })
      .catch((err: unknown) => recordEngineError(err));
    // Also keep the Web Audio anchor in sync so `handoffToWebAudio` uses
    // the latest tempo when the app comes back to the foreground.
    if (anchorRef.current !== null) {
      anchorRef.current = { ...anchorRef.current, bpm, beatsPerBar };
    }
  }, [isPlaying, bpm, beatsPerBar, accentPattern]);

  // When a tempo map is loaded and the user hits Play, schedule each upcoming
  // BPM change. Each timer fires HANDOFF_LOOKAHEAD_MS before the target time
  // so the existing handoff effect lands the new tempo on the right beat.
  // We pump tempo changes through `setBpm`, which triggers the seamless
  // handoff above. Stop or clear cancels every pending timer.
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

  return (
    <div className="flex w-full max-w-xl flex-col items-center gap-3 sm:gap-5">
      {/* Hero: tap circle to play/pause. Dots row sits directly under it. */}
      <PlayCircle
        beat={currentBeat}
        beatsPerBar={beatsPerBar}
        isPlaying={isPlaying}
        disabled={isMember}
        onToggle={() => setPlaying(!isPlaying)}
      />
      {/* BeatIndicator renders the clickable dot row (accent/normal/mute cycle)
          and the hero flash circle. We hide the flash circle here because
          PlayCircle provides the primary play indicator. The dots remain
          interactive — clicking cycles each beat through its three states. */}
      <div className="[&>div]:gap-0 [&>div>div:first-child]:hidden">
        <BeatIndicator beat={currentBeat} beatsPerBar={beatsPerBar} isPlaying={isPlaying} />
      </div>

      {/* Tempo: large editable number + slider underneath. */}
      <div className="flex w-full flex-col items-center gap-1">
        <div className="text-[10px] uppercase tracking-widest text-ink-500 dark:text-ink-400">
          {COPY.solo.bpm}
        </div>
        <input
          ref={bpmInputRef}
          type="number"
          inputMode="decimal"
          step="0.1"
          min={30}
          max={300}
          disabled={isMember}
          // 7ch fits "300.0" with room to breathe; tabular-nums keeps every digit
          // the same width so toggling between view and edit modes doesn't shift layout.
          className={[
            'w-[7ch] bg-transparent text-center text-5xl sm:text-6xl font-bold tabular-nums tracking-tight',
            'cursor-text rounded-md border-none outline-none',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
            'appearance-none [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield]',
            'disabled:opacity-60 disabled:cursor-not-allowed',
          ].join(' ')}
          value={bpmDraft ?? bpm.toFixed(1)}
          onFocus={(e) => {
            setBpmDraft(bpm.toFixed(1));
            // Select on focus so a click-and-type replaces the value, matching
            // user expectation for "click number → type new tempo".
            e.currentTarget.select();
          }}
          onChange={(e) => setBpmDraft(e.target.value)}
          onBlur={commitBpmDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitBpmDraft();
              bpmInputRef.current?.blur();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancelBpmDraft();
            }
          }}
          aria-label={COPY.solo.bpm}
        />
        <input
          type="range"
          min={30}
          max={300}
          step={1}
          value={bpm}
          onChange={(e) => setBpm(Number(e.target.value))}
          disabled={isMember}
          className="w-full max-w-sm accent-accent disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label={COPY.solo.bpm}
        />
      </div>

      {/* Toolbar: secondary controls in one row. */}
      <div className="flex w-full flex-wrap items-center justify-center gap-2 sm:gap-3">
        <TapButton onBpm={setBpm} disabled={isMember} />
        <label
          className={[
            'inline-flex items-center gap-2 rounded-full border border-ink-200 dark:border-ink-700 px-3 py-2 text-sm',
            isMember ? 'opacity-50' : '',
          ].join(' ')}
        >
          <span className="text-ink-500 dark:text-ink-400">{COPY.solo.beatsPerBar}</span>
          <select
            value={beatsPerBar}
            onChange={(e) => setBeatsPerBar(Number(e.target.value))}
            disabled={isMember}
            className="bg-transparent font-semibold tabular-nums disabled:cursor-not-allowed focus:outline-none"
            aria-label={COPY.solo.beatsPerBar}
          >
            {[2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {/* Unlike every other control above, Tone Profile is deliberately left
            enabled for members: per CONTEXT.md it's local-only per Voice and
            never propagates over the wire, so a member's choice can never
            desync group timing. */}
        <ToneProfileSelector />
        <OutputToggles />
        <MidiSheet disabled={isMember} />
      </div>

      {isMember && (
        <div role="status" className="text-xs text-ink-500 dark:text-ink-400">
          {COPY.session.memberHint}
        </div>
      )}
    </div>
  );
}

function startScheduler(
  ctx: AudioContext,
  anchor: Anchor,
  setCurrentBeat: (beat: number) => void,
  beatsPerBarRef: { current: number },
  hapticEnabledRef: { current: boolean },
  toneProfileRef: { current: ToneProfile },
  accentPatternRef: { current: BeatState[] },
  tuning: SchedulerTuning,
): RunningClick {
  const tempo = [{ startAt: anchor.startAt, bpm: anchor.bpm, beatsPerBar: anchor.beatsPerBar }];
  return startClick(tempo, {
    audioCtx: ctx,
    lookaheadSec: tuning.lookaheadSec,
    scheduleIntervalMs: tuning.scheduleIntervalMs,
    // Read the offset from the store on every tick so a fresh ping estimate
    // (every 30 s + burst at connect) auto-corrects clock drift within one tick.
    nowServerMs: () => Date.now() + useMetronome.getState().sessionClockOffsetMs,
    // Closures so a profile or pattern change takes effect on the very next
    // scheduled beat without tearing down and restarting the engine.
    voice: (args) => getVoice(toneProfileRef.current)(args),
    beatStateFor: (beat) => {
      const pattern = accentPatternRef.current;
      if (pattern.length === 0) return 'normal';
      const pos = ((beat % pattern.length) + pattern.length) % pattern.length;
      return pattern[pos] ?? 'normal';
    },
    onBeatScheduled: (beat, audioTime) => {
      recordBeat(beat, audioTime);
      // Schedule UI flash + haptic at the audio time. requestAnimationFrame
      // alignment is approximate; for solo mode this is good enough.
      setTimeout(() => {
        setCurrentBeat(beat);
        if (!hapticEnabledRef.current) return;
        // Haptic follows the user's accent pattern: accent = strong pulse,
        // normal = light pulse, mute = no pulse. Matches audio behavior
        // exactly — a beat the user muted is silent AND vibration-less.
        const pattern = accentPatternRef.current;
        const bpbNow = beatsPerBarRef.current;
        const state =
          pattern.length === 0
            ? beat % bpbNow === 0
              ? 'accent'
              : 'normal'
            : pattern[((beat % pattern.length) + pattern.length) % pattern.length] ?? 'normal';
        if (state === 'mute') return;
        pulse(state === 'accent' ? 60 : 20);
      }, 0);
    },
  });
}
