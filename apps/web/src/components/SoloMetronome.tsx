import { useEffect, useRef } from 'react';
import { startClick, type RunningClick, pulse } from '@clickkeep/click-engine';
import { useMetronome } from '../lib/store.js';
import { getAudioContext } from '../lib/audio.js';
import { COPY } from '../copy/strings.js';
import { BeatIndicator } from './BeatIndicator.js';
import { TapButton } from './TapButton.js';

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
  const { bpm, beatsPerBar, isPlaying, currentBeat, setBpm, setBeatsPerBar, setPlaying, setCurrentBeat } =
    useMetronome();
  const runningRef = useRef<RunningClick | null>(null);
  const anchorRef = useRef<Anchor | null>(null);
  // Read latest beatsPerBar inside the scheduler callback without rebinding it,
  // so signature changes also flow through without restarting the engine.
  const beatsPerBarRef = useRef(beatsPerBar);
  beatsPerBarRef.current = beatsPerBar;

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
    runningRef.current = startScheduler(ctx, anchor, setCurrentBeat, beatsPerBarRef);
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
    runningRef.current = startScheduler(ctx, nextAnchor, setCurrentBeat, beatsPerBarRef);
  }, [bpm, beatsPerBar, isPlaying, setCurrentBeat]);

  return (
    <div className="flex flex-col items-center gap-8">
      <BeatIndicator beat={currentBeat} beatsPerBar={beatsPerBar} isPlaying={isPlaying} />

      <div className="flex flex-col items-center gap-2">
        <div className="text-6xl font-bold tabular-nums tracking-tight">{bpm}</div>
        <div className="text-sm uppercase tracking-widest text-ink-500 dark:text-ink-400">{COPY.solo.bpm}</div>
      </div>

      <input
        type="range"
        min={30}
        max={300}
        value={bpm}
        onChange={(e) => setBpm(Number(e.target.value))}
        className="w-full max-w-md accent-accent"
        aria-label={COPY.solo.bpm}
      />

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink-500 dark:text-ink-400">{COPY.solo.beatsPerBar}</span>
          <select
            value={beatsPerBar}
            onChange={(e) => setBeatsPerBar(Number(e.target.value))}
            className="rounded-md border border-ink-200 dark:border-ink-700 bg-transparent px-2 py-1"
          >
            {[2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-6">
        <TapButton onBpm={setBpm} />
        <button
          type="button"
          onClick={() => setPlaying(!isPlaying)}
          className={[
            'h-20 rounded-full px-10 text-lg font-semibold',
            'transition-transform active:scale-95',
            isPlaying
              ? 'bg-ink-800 dark:bg-ink-100 text-ink-50 dark:text-ink-900'
              : 'bg-accent text-ink-900 hover:bg-accent-600',
          ].join(' ')}
        >
          {isPlaying ? COPY.solo.stop : COPY.solo.play}
        </button>
      </div>
    </div>
  );
}

function startScheduler(
  ctx: AudioContext,
  anchor: Anchor,
  setCurrentBeat: (beat: number) => void,
  beatsPerBarRef: { current: number },
): RunningClick {
  const tempo = [{ startAt: anchor.startAt, bpm: anchor.bpm, beatsPerBar: anchor.beatsPerBar }];
  return startClick(tempo, {
    audioCtx: ctx,
    nowServerMs: () => performance.now(),
    onBeatScheduled: (beat) => {
      // Schedule UI flash + haptic at the audio time. requestAnimationFrame
      // alignment is approximate; for solo mode this is good enough.
      setTimeout(() => {
        setCurrentBeat(beat);
        // Read the latest signature so handoffs feel correct on the very
        // first beat after a change, even before React re-renders.
        const bpbNow = beatsPerBarRef.current;
        if (beat % bpbNow === 0) pulse(60);
        else pulse(20);
      }, 0);
    },
  });
}
