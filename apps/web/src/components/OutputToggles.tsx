import { useEffect } from 'react';
import { useMetronome } from '../lib/store.js';
import { setMuted as setAudioMuted } from '../lib/audio.js';
import { COPY } from '../copy/strings.js';

/**
 * Three independent per-member output toggles: audio / visual / haptic.
 * All default ON. Each only affects the local device — no session traffic.
 */
export function OutputToggles(): JSX.Element {
  const muted = useMetronome((s) => s.muted);
  const toggleMuted = useMetronome((s) => s.toggleMuted);
  const visualEnabled = useMetronome((s) => s.visualEnabled);
  const toggleVisualEnabled = useMetronome((s) => s.toggleVisualEnabled);
  const hapticEnabled = useMetronome((s) => s.hapticEnabled);
  const toggleHapticEnabled = useMetronome((s) => s.toggleHapticEnabled);

  useEffect(() => {
    setAudioMuted(muted);
  }, [muted]);

  const audioLabel = muted ? COPY.solo.unmute : COPY.solo.mute;
  const visualLabel = visualEnabled ? COPY.solo.visualOn : COPY.solo.visualOff;
  const hapticLabel = hapticEnabled ? COPY.solo.hapticOn : COPY.solo.hapticOff;

  // `audio` toggle is pressed when muted (output OFF); visual/haptic are
  // pressed when output is OFF to keep "pressed === silenced" consistent.
  return (
    <div className="flex items-center gap-2" role="group" aria-label="Output toggles">
      <ToggleButton
        pressed={muted}
        onClick={toggleMuted}
        label={audioLabel}
        icon={<AudioIcon off={muted} />}
      />
      <ToggleButton
        pressed={!visualEnabled}
        onClick={toggleVisualEnabled}
        label={visualLabel}
        icon={<VisualIcon off={!visualEnabled} />}
      />
      <ToggleButton
        pressed={!hapticEnabled}
        onClick={toggleHapticEnabled}
        label={hapticLabel}
        icon={<HapticIcon off={!hapticEnabled} />}
      />
    </div>
  );
}

interface ToggleButtonProps {
  pressed: boolean;
  onClick: () => void;
  label: string;
  icon: JSX.Element;
}

function ToggleButton({ pressed, onClick, label, icon }: ToggleButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      className={[
        'h-10 w-10 rounded-full text-lg flex items-center justify-center',
        'border border-ink-200 dark:border-ink-700',
        'transition-colors',
        pressed
          ? 'bg-ink-800 dark:bg-ink-100 text-ink-50 dark:text-ink-900'
          : 'bg-transparent text-ink-700 dark:text-ink-200 hover:bg-ink-100 dark:hover:bg-ink-800',
      ].join(' ')}
    >
      {icon}
    </button>
  );
}

function AudioIcon({ off }: { off: boolean }): JSX.Element {
  return (
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
      {off ? (
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
  );
}

function VisualIcon({ off }: { off: boolean }): JSX.Element {
  return (
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
      <circle cx="12" cy="12" r="4" fill={off ? 'none' : 'currentColor'} />
      <path d="M12 3 V5" />
      <path d="M12 19 V21" />
      <path d="M3 12 H5" />
      <path d="M19 12 H21" />
      <path d="M5.6 5.6 L7 7" />
      <path d="M17 17 L18.4 18.4" />
      <path d="M5.6 18.4 L7 17" />
      <path d="M17 7 L18.4 5.6" />
      {off ? <line x1="4" y1="20" x2="20" y2="4" /> : null}
    </svg>
  );
}

function HapticIcon({ off }: { off: boolean }): JSX.Element {
  return (
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
      <rect x="7" y="3" width="10" height="18" rx="2" />
      <line x1="11" y1="18" x2="13" y2="18" />
      {off ? <line x1="4" y1="20" x2="20" y2="4" /> : null}
    </svg>
  );
}
