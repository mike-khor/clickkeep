import { useRef, useState } from 'react';
import { TapTempo } from '@clickkeep/sync-core';
import { COPY } from '../copy/strings.js';

interface Props {
  onBpm: (bpm: number) => void;
  disabled?: boolean;
}

export function TapButton({ onBpm, disabled = false }: Props): JSX.Element {
  const tapperRef = useRef(new TapTempo());
  const [lastTapMs, setLastTapMs] = useState<number | null>(null);

  const handleTap = (): void => {
    const now = performance.now();
    setLastTapMs(now);
    const bpm = tapperRef.current.tap(now);
    if (bpm !== null) onBpm(Math.round(bpm));
  };

  // Visual ping right after the tap.
  const pulsing = lastTapMs !== null && performance.now() - lastTapMs < 120;

  return (
    <button
      type="button"
      onClick={handleTap}
      disabled={disabled}
      className={[
        'flex h-20 w-20 items-center justify-center rounded-full text-lg font-medium',
        'border-2 border-ink-300 dark:border-ink-600',
        'bg-ink-50 dark:bg-ink-800 hover:bg-ink-100 dark:hover:bg-ink-700',
        'transition-transform active:scale-95',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-ink-50 dark:disabled:hover:bg-ink-800',
        pulsing ? 'scale-95' : '',
      ].join(' ')}
      aria-label={COPY.solo.tapHint}
    >
      {COPY.solo.tap}
    </button>
  );
}
