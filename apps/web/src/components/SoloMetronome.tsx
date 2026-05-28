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
import { getAudioContext, recordBeat, recordEngineError, resetEngineStats } from '../lib/audio.js';
import { COPY } from '../copy/strings.js';
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

interface Anchor {
  startAt: number;
  bpm: number;
  beatsPerBar: number;
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
    // Solo mode anchors the tempo map at "now". Server time === local time here.
    const startAt = performance.now();
    const anchor: Anchor = { startAt, bpm, beatsPerBar };
    anchorRef.current = anchor;
    resetEngineStats();
    // startClick fires its first tick synchronously, so a broken AudioContext
    // throws here on construction. Ticks 2..N run inside setInterval and surface
    // via the window 'error' listener installed in audio.ts — both paths feed
    // the same recentErrors buffer.
    try {
      runningRef.current = startScheduler(
        ctx,
        anchor,
        setCurrentBeat,
        beatsPerBarRef,
        hapticEnabledRef,
        toneProfileRef,
        accentPatternRef,
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
    const prev = anchorRef.current;
    if (prev === null) return;
    if (prev.bpm === bpm && prev.beatsPerBar === beatsPerBar) return;

    const now = performance.now();
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
    );
  }, [bpm, beatsPerBar, isPlaying, setCurrentBeat]);

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
        <ToneProfileSelector disabled={isMember} />
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
): RunningClick {
  const tempo = [{ startAt: anchor.startAt, bpm: anchor.bpm, beatsPerBar: anchor.beatsPerBar }];
  return startClick(tempo, {
    audioCtx: ctx,
    nowServerMs: () => performance.now(),
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
        // Read the latest signature so handoffs feel correct on the very
        // first beat after a change, even before React re-renders.
        const bpbNow = beatsPerBarRef.current;
        if (!hapticEnabledRef.current) return;
        // Haptic still mirrors the natural downbeat — muted/accent state only
        // affects audio output. Visual + haptic always fire so members feel
        // every beat regardless of audio configuration.
        if (beat % bpbNow === 0) pulse(60);
        else pulse(20);
      }, 0);
    },
  });
}
