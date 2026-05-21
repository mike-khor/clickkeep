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
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M11 5 L6 9 H3 V15 H6 L11 19 Z" />
        {muted ? (
          <>
            <line x1="16" y1="9" x2="22" y2="15" />
            <line x1="22" y1="9" x2="16" y2="15" />
          </>
        ) : (
          <>
            <path d="M16 8 a5 5 0 0 1 0 8" />
            <path d="M19 5 a9 9 0 0 1 0 14" />
          </>
        )}
      </svg>
    </button>
  );
}
