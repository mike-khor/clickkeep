import { useEffect, useState } from 'react';
import { useMetronome } from '../lib/store.js';

interface Props {
  beat: number;
  beatsPerBar: number;
  isPlaying: boolean;
  disabled: boolean;
  onToggle: () => void;
}

/**
 * The hero: a big circle that visualizes the beat AND is the play/pause button.
 * Tap toggles. Renders a play triangle when stopped and pause bars when running.
 *
 * We render our own flash here (rather than reusing BeatIndicator's circle) so
 * the size scales fluidly with viewport via clamp(). BeatIndicator continues to
 * own the dot row underneath — its click semantics and per-state colors are
 * untouched (sound-customization agent owns those).
 */
export function PlayCircle({ beat, beatsPerBar, isPlaying, disabled, onToggle }: Props): JSX.Element {
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

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-label={isPlaying ? 'Pause' : 'Play'}
      aria-pressed={isPlaying}
      className={[
        'no-tap-highlight group relative rounded-full',
        // Hero sizing: scales with viewport, capped so it never dominates a
        // small mobile screen or floats lost in the middle of a desktop.
        'h-[clamp(180px,52vw,300px)] w-[clamp(180px,52vw,300px)]',
        'sm:h-[clamp(220px,38vh,320px)] sm:w-[clamp(220px,38vh,320px)]',
        'transition-all duration-75',
        // Resting flash colors (no beat) — depend on play state for a subtle
        // "armed" look when stopped vs. "active surface" when running.
        showFlash
          ? isDownbeat
            ? 'bg-accent scale-[1.04] shadow-2xl shadow-accent/40'
            : 'bg-ink-300 dark:bg-ink-500 scale-[1.03]'
          : isPlaying
            ? 'bg-ink-200 dark:bg-ink-800 scale-100'
            : 'bg-ink-100 dark:bg-ink-800 scale-100',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/40',
        'disabled:cursor-not-allowed disabled:opacity-60',
        'active:scale-[0.98]',
      ].join(' ')}
    >
      <span
        className={[
          'pointer-events-none absolute inset-0 flex items-center justify-center',
          'transition-transform duration-150 ease-out',
          'group-hover:scale-105 group-active:scale-95',
          // Hide icon during the bright accent flash on the downbeat so it
          // doesn't look like a frozen pause overlay; it returns instantly.
          showFlash && isDownbeat ? 'opacity-0' : 'opacity-100',
          disabled ? 'group-hover:scale-100' : '',
        ].join(' ')}
      >
        {isPlaying ? <PauseIcon /> : <PlayIcon />}
      </span>
    </button>
  );
}

function PlayIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-[28%] w-[28%] text-ink-800 dark:text-ink-100 drop-shadow-sm"
      fill="currentColor"
    >
      {/* Triangle nudged right by 1.5 to feel optically centered. */}
      <path d="M7.5 4.5 L7.5 19.5 L20 12 Z" />
    </svg>
  );
}

function PauseIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-[26%] w-[26%] text-ink-800 dark:text-ink-100 drop-shadow-sm"
      fill="currentColor"
    >
      <rect x="6" y="4.5" width="4.25" height="15" rx="1" />
      <rect x="13.75" y="4.5" width="4.25" height="15" rx="1" />
    </svg>
  );
}
