import { useEffect, useRef, useState } from 'react';
import { useMetronome } from '../lib/store.js';
import { useMetronomeEngine } from '../hooks/useMetronomeEngine.js';
import { COPY } from '../copy/strings.js';
import { BeatIndicator } from './BeatIndicator.js';
import { TapButton } from './TapButton.js';
import { OutputToggles } from './OutputToggles.js';
import { PlayCircle } from './PlayCircle.js';
import { MidiSheet } from './MidiSheet.js';
import { ToneProfileSelector } from './ToneProfileSelector.js';

export function SoloMetronome(): JSX.Element {
  const {
    bpm,
    beatsPerBar,
    isPlaying,
    currentBeat,
    sessionRole,
    setBpm,
    setBeatsPerBar,
    setPlaying,
  } = useMetronome();

  // Everything audio + scheduling + native handoff lives in the engine hook.
  // This component is UI + spacebar-hotkey only.
  useMetronomeEngine();

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
        {/* Unlike every other control above, Tone Profile is deliberately left
            enabled for members: per CONTEXT.md it's local-only per Voice and
            never propagates over the wire, so a member's choice can never
            desync group timing. */}
        <ToneProfileSelector />
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
