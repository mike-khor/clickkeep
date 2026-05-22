import { useEffect, useState } from 'react';
import { useMetronome } from '../lib/store.js';

interface Props {
  /** Currently scheduled beat number (monotonic). */
  beat: number;
  beatsPerBar: number;
  isPlaying: boolean;
}

/**
 * Big visual flash on each beat. Accent (orange) on the downbeat, neutral on others.
 * Renders a row of dots showing the position within the bar. When the user
 * disables the visual output, we keep the layout (static dot + dim dots) so
 * the surrounding UI doesn't jump.
 */
export function BeatIndicator({ beat, beatsPerBar, isPlaying }: Props): JSX.Element {
  const visualEnabled = useMetronome((s) => s.visualEnabled);
  const [flashing, setFlashing] = useState(false);
  const positionInBar = ((beat % beatsPerBar) + beatsPerBar) % beatsPerBar;
  const isDownbeat = positionInBar === 0;

  useEffect(() => {
    if (!isPlaying) return;
    setFlashing(true);
    const t = setTimeout(() => setFlashing(false), 90);
    return () => clearTimeout(t);
  }, [beat, isPlaying]);

  const showFlash = flashing && isPlaying && visualEnabled;
  const showDotHighlight = isPlaying && visualEnabled;

  return (
    <div className="flex flex-col items-center gap-6">
      <div
        className={[
          'h-48 w-48 rounded-full transition-all duration-75',
          showFlash
            ? isDownbeat
              ? 'bg-accent scale-105 shadow-2xl shadow-accent/50'
              : 'bg-ink-300 dark:bg-ink-500 scale-105'
            : 'bg-ink-100 dark:bg-ink-800 scale-100',
        ].join(' ')}
        aria-hidden
      />
      <div className="flex gap-2" role="status" aria-label={`Beat ${positionInBar + 1} of ${beatsPerBar}`}>
        {Array.from({ length: beatsPerBar }).map((_, i) => (
          <div
            key={i}
            className={[
              'h-3 w-3 rounded-full',
              i === positionInBar && showDotHighlight
                ? i === 0
                  ? 'bg-accent'
                  : 'bg-ink-500 dark:bg-ink-300'
                : 'bg-ink-200 dark:bg-ink-700',
            ].join(' ')}
          />
        ))}
      </div>
    </div>
  );
}
