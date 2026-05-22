import { TONE_PROFILES, type ToneProfile } from '@clickkeep/click-engine';
import { useMetronome } from '../lib/store.js';
import { COPY } from '../copy/strings.js';

const PROFILE_LABELS: Record<ToneProfile, string> = {
  pitched: 'Pitched',
  'pitched-alt': 'Pitched alt',
  woodblock: 'Woodblock',
  snap: 'Snap',
  'hi-hat': 'Hi-hat',
};

interface Props {
  disabled?: boolean;
}

/**
 * Simple <select> for the click voice. Visual polish (segmented control,
 * preview button, etc.) is the UI-overhaul agent's job — keep this minimal.
 */
export function ToneProfileSelector({ disabled = false }: Props): JSX.Element {
  const toneProfile = useMetronome((s) => s.toneProfile);
  const setToneProfile = useMetronome((s) => s.setToneProfile);

  return (
    <label className={['flex items-center gap-2 text-sm', disabled ? 'opacity-50' : ''].join(' ')}>
      <span className="text-ink-500 dark:text-ink-400">{COPY.solo.tone}</span>
      <select
        value={toneProfile}
        onChange={(e) => setToneProfile(e.target.value as ToneProfile)}
        disabled={disabled}
        className="rounded-md border border-ink-200 dark:border-ink-700 bg-transparent px-2 py-1 disabled:cursor-not-allowed"
      >
        {TONE_PROFILES.map((id) => (
          <option key={id} value={id}>
            {PROFILE_LABELS[id]}
          </option>
        ))}
      </select>
    </label>
  );
}
