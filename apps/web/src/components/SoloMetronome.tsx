import { useEffect, useRef } from 'react';
import { startClick, type RunningClick, pulse } from '@clickkeep/click-engine';
import { useMetronome } from '../lib/store.js';
import { getAudioContext } from '../lib/audio.js';
import { COPY } from '../copy/strings.js';
import { BeatIndicator } from './BeatIndicator.js';
import { TapButton } from './TapButton.js';

export function SoloMetronome(): JSX.Element {
  const { bpm, beatsPerBar, isPlaying, currentBeat, setBpm, setBeatsPerBar, setPlaying, setCurrentBeat } =
    useMetronome();
  const runningRef = useRef<RunningClick | null>(null);

  useEffect(() => {
    if (!isPlaying) {
      runningRef.current?.stop();
      runningRef.current = null;
      return;
    }
    const ctx = getAudioContext();
    // Solo mode anchors the tempo map at "now". Server time === local time here.
    const startAt = performance.now();
    const tempo = [{ startAt, bpm, beatsPerBar }];
    runningRef.current = startClick(tempo, {
      audioCtx: ctx,
      nowServerMs: () => performance.now(),
      onBeatScheduled: (beat) => {
        // Schedule UI flash + haptic at the audio time. requestAnimationFrame
        // alignment is approximate; for solo mode this is good enough.
        setTimeout(() => {
          setCurrentBeat(beat);
          if (beat % beatsPerBar === 0) pulse(60);
          else pulse(20);
        }, 0);
      },
    });
    return () => {
      runningRef.current?.stop();
      runningRef.current = null;
    };
    // We intentionally restart the engine on tempo / signature change rather than
    // mutating it mid-flight; the scheduler is simple by design.
  }, [isPlaying, bpm, beatsPerBar, setCurrentBeat]);

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
