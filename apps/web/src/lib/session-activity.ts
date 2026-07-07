// Owner-only "member activity" log. Derived entirely client-side from the
// `member-count` deltas the worker already broadcasts (see
// packages/sync-core/src/types.ts) — no new wire message, no per-member
// identity. A count going up means someone joined; going down means someone
// left. We can't (yet) say who.
//
// This module is deliberately framework-free so the delta-tracking logic is
// testable without mounting SessionPanel.

export interface ActivityEvent {
  id: number;
  kind: 'joined' | 'left';
  /** How many members joined/left in this single count transition. Usually 1. */
  delta: number;
  /** Wall-clock ms (Date.now()) when this transition was observed locally. */
  atMs: number;
}

const MAX_EVENTS = 50;
const ENABLED_KEY = 'clickkeep:session-activity:enabled';

/** Opt-in preference: owner must explicitly reveal the log. Default OFF so the
 * session sheet stays exactly as busy as it is today for everyone who doesn't
 * ask for this. localStorage is best-effort, same pattern as output-prefs.ts. */
export function getStoredActivityEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setStoredActivityEnabled(v: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, v ? '1' : '0');
  } catch {
    // Persistence is best-effort.
  }
}

let nextEventId = 1;

/**
 * Given the existing log and a freshly-received member count, returns the
 * next log with at most one new entry appended (capped to MAX_EVENTS, oldest
 * dropped first). `previousCount === null` means "no baseline yet" (first
 * count seen after connecting) — we deliberately do NOT log an event for it,
 * since there's no prior count to diff against and we'd otherwise report a
 * false "N members joined" the instant anyone connects.
 */
export function appendActivityEvent(
  log: readonly ActivityEvent[],
  previousCount: number | null,
  nextCount: number,
  atMs: number = Date.now(),
): ActivityEvent[] {
  if (previousCount === null || nextCount === previousCount) return log as ActivityEvent[];
  const delta = Math.abs(nextCount - previousCount);
  const kind: ActivityEvent['kind'] = nextCount > previousCount ? 'joined' : 'left';
  const next = [...log, { id: nextEventId++, kind, delta, atMs }];
  return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
}

/** HH:MM (24h, local time) — an absolute clock reading is simpler than a
 * relative "Ns ago" label because it never needs a re-render timer to stay
 * accurate while the sheet is open. */
export function formatActivityTime(atMs: number): string {
  const d = new Date(atMs);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
