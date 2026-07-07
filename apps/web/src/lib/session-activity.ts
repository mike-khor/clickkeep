// Owner-only "member activity" log. Derived entirely client-side from the
// `member-count` deltas the worker already broadcasts (see
// packages/sync-core/src/types.ts) — no new wire message, no per-member
// identity. A count going up means someone joined; going down means someone
// left. We can't (yet) say who.
//
// This module is deliberately framework-free so the delta-tracking logic is
// testable without mounting SessionPanel. The React-side wiring (baseline
// reset on reconnect, opt-in preference, memoized derivation) lives in
// hooks/useMemberActivityLog.ts. The opt-in localStorage preference itself
// lives in lib/output-prefs.ts alongside the other per-user UI toggles.

export interface ActivityEvent {
  id: number;
  kind: 'joined' | 'left';
  /** How many members joined/left in this single count transition. Usually 1. */
  delta: number;
  /** Wall-clock ms (Date.now()) when this transition was observed locally. */
  atMs: number;
}

const MAX_EVENTS = 50;

/**
 * Given the existing log and a freshly-received member count, returns the
 * next log with at most one new entry appended (capped to MAX_EVENTS, oldest
 * dropped first). `previousCount === null` means "no baseline yet" (first
 * count seen after connecting) — we deliberately do NOT log an event for it,
 * since there's no prior count to diff against and we'd otherwise report a
 * false "N members joined" the instant anyone connects.
 *
 * Event ids are derived from the tail of the log (last id + 1) rather than a
 * module-level counter, so tests and re-mounts see fresh, order-independent
 * ids without needing to reset any hidden state.
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
  const nextId = (log[log.length - 1]?.id ?? 0) + 1;
  const next = [...log, { id: nextId, kind, delta, atMs }];
  return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
}

// Cached at module load — Intl.DateTimeFormat is expensive to construct on
// every render, and cheap once built.
const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

/** A short absolute clock reading in the user's locale (e.g. "9:05 AM" or
 * "09:05"). Absolute time is simpler than a relative "Ns ago" label because it
 * never needs a re-render timer to stay accurate while the sheet is open. */
export function formatActivityTime(atMs: number): string {
  return TIME_FORMATTER.format(new Date(atMs));
}
