import { useEffect, useState } from 'react';
import type { BeatState } from '@clickkeep/click-engine';
import { useMetronome } from '../lib/store.js';
import { COPY } from '../copy/strings.js';

interface Props {
  /** Currently scheduled beat number (monotonic). */
  beat: number;
  beatsPerBar: number;
  isPlaying: boolean;
}

/**
 * Big visual flash on each beat. Accent color on accent beats, neutral elsewhere
 * (mute included — visual fires regardless of audio state). Below the circle is
 * a row of clickable dots that cycles each beat through accent → normal → mute.
 */
export function BeatIndicator({ beat, beatsPerBar, isPlaying }: Props): JSX.Element {
  const visualEnabled = useMetronome((s) => s.visualEnabled);
  const accentPattern = useMetronome((s) => s.accentPattern);
  const cycleBeatState = useMetronome((s) => s.cycleBeatState);
  const sessionRole = useMetronome((s) => s.sessionRole);
  const [flashing, setFlashing] = useState(false);
  const positionInBar = ((beat % beatsPerBar) + beatsPerBar) % beatsPerBar;
  const activeState: BeatState = accentPattern[positionInBar] ?? 'normal';
  const isAccent = activeState === 'accent';
  const isMember = sessionRole === 'member';

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
            ? isAccent
              ? 'bg-accent scale-105 shadow-2xl shadow-accent/50'
              : 'bg-ink-300 dark:bg-ink-500 scale-105'
            : 'bg-ink-100 dark:bg-ink-800 scale-100',
        ].join(' ')}
        aria-hidden
      />
      <div
        className="flex gap-2"
        role="group"
        aria-label={COPY.solo.accentPatternLabel}
      >
        {accentPattern.map((state, i) => (
          <BeatDot
            key={i}
            index={i}
            state={state}
            active={i === positionInBar && showDotHighlight}
            disabled={isMember}
            onCycle={() => cycleBeatState(i)}
          />
        ))}
      </div>
    </div>
  );
}

interface BeatDotProps {
  index: number;
  state: BeatState;
  active: boolean;
  disabled: boolean;
  onCycle: () => void;
}

function BeatDot({ index, state, active, disabled, onCycle }: BeatDotProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onCycle}
      disabled={disabled}
      aria-label={`Beat ${index + 1}: ${state}. Click to change.`}
      title={`Beat ${index + 1}: ${state}`}
      className={[
        'h-4 w-4 rounded-full transition-all',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:scale-110',
        dotColorClass(state, active),
      ].join(' ')}
    />
  );
}

function dotColorClass(state: BeatState, active: boolean): string {
  if (active) {
    // Currently-playing beat: brand color overlay regardless of underlying state.
    return 'bg-accent scale-110 shadow-md shadow-accent/40';
  }
  if (state === 'accent') return 'bg-accent/80';
  if (state === 'normal') return 'bg-ink-500 dark:bg-ink-400';
  return 'bg-ink-200 dark:bg-ink-700';
}
