import { useEffect } from 'react';
import { useMetronome } from '../lib/store.js';
import { setMuted as setAudioMuted } from '../lib/audio.js';
import { COPY } from '../copy/strings.js';

/**
 * Mute the audible click without affecting visual flash or haptic pulses.
 *
 * The button only toggles a flag in the store + the master gain node in
 * audio.ts. The click-engine scheduler keeps running so toggling mid-playback
 * is seamless — no rescheduling, no click pile-up.
 */
export function MuteButton(): JSX.Element {
  const muted = useMetronome((s) => s.muted);
  const toggleMuted = useMetronome((s) => s.toggleMuted);

  useEffect(() => {
    setAudioMuted(muted);
  }, [muted]);

  const label = muted ? COPY.solo.unmute : COPY.solo.mute;
  return (
    <button
      type="button"
      onClick={toggleMuted}
      aria-pressed={muted}
      aria-label={label}
      title={label}
      className={[
        'h-10 w-10 rounded-full text-lg flex items-center justify-center',
        'border border-ink-200 dark:border-ink-700',
        'transition-colors',
        muted
          ? 'bg-ink-800 dark:bg-ink-100 text-ink-50 dark:text-ink-900'
          : 'bg-transparent text-ink-700 dark:text-ink-200 hover:bg-ink-100 dark:hover:bg-ink-800',
      ].join(' ')}
    >
      <span aria-hidden="true">{muted ? '\u{1F507}' : '\u{1F50A}'}</span>
    </button>
  );
}
