// Persists the three independent per-output toggle preferences across reloads.
// localStorage is best-effort: private-browsing / quota errors fall back to the
// in-memory store value for the session.

const MUTED_KEY = 'clickkeep:muted';
const VISUAL_KEY = 'clickkeep:visual-enabled';
const HAPTIC_KEY = 'clickkeep:haptic-enabled';

function readBool(key: string, defaultValue: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return defaultValue;
    return v === '1';
  } catch {
    return defaultValue;
  }
}

function writeBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // Persistence is best-effort.
  }
}

export const getStoredMuted = (): boolean => readBool(MUTED_KEY, false);
export const setStoredMuted = (v: boolean): void => writeBool(MUTED_KEY, v);

export const getStoredVisualEnabled = (): boolean => readBool(VISUAL_KEY, true);
export const setStoredVisualEnabled = (v: boolean): void => writeBool(VISUAL_KEY, v);

export const getStoredHapticEnabled = (): boolean => readBool(HAPTIC_KEY, true);
export const setStoredHapticEnabled = (v: boolean): void => writeBool(HAPTIC_KEY, v);
