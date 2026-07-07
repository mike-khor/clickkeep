// Persists the three independent per-output toggle preferences across reloads.
// localStorage is best-effort: private-browsing / quota errors fall back to the
// in-memory store value for the session.

const MUTED_KEY = 'clickkeep:muted';
const VISUAL_KEY = 'clickkeep:visual-enabled';
const HAPTIC_KEY = 'clickkeep:haptic-enabled';
// Owner-only opt-in for the join/leave log inside the Session sheet. Kept
// alongside the other UI toggles so all localStorage-backed prefs live in one
// file. Storage key preserved (`clickkeep:session-activity:enabled`) so
// existing users don't lose their preference on upgrade.
const SESSION_ACTIVITY_KEY = 'clickkeep:session-activity:enabled';

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

export const getStoredSessionActivityEnabled = (): boolean => readBool(SESSION_ACTIVITY_KEY, false);
export const setStoredSessionActivityEnabled = (v: boolean): void => writeBool(SESSION_ACTIVITY_KEY, v);
