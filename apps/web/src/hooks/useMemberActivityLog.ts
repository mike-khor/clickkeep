import { useEffect, useRef, useState } from 'react';
import { appendActivityEvent, type ActivityEvent } from '../lib/session-activity.js';
import {
  getStoredSessionActivityEnabled,
  setStoredSessionActivityEnabled,
} from '../lib/output-prefs.js';

export interface UseMemberActivityLogResult {
  /** The full accrued join/leave log for the current connection. */
  events: ActivityEvent[];
  /** Whether the owner has opted in to seeing the log. Persists via localStorage. */
  enabled: boolean;
  /** Flip the enabled preference (and persist). */
  onToggle: () => void;
}

/**
 * Consolidates every join/leave-log seam that used to be sprinkled across
 * SessionPanel: the baseline `useRef`, the events state, the opt-in
 * preference, and — most importantly — the reset-on-reconnect wiring.
 *
 * Historical footgun this replaces: the previous inline implementation queued
 * `setActivityLog(log => appendActivityEvent(log, prevMemberCountRef.current, n))`
 * and THEN mutated `prevMemberCountRef.current = n`. Because React 18 defers
 * the updater, by the time it read `prevMemberCountRef.current` the ref was
 * already `n`, collapsing every call to "count unchanged" — so the log
 * silently accrued zero entries in production. Capturing `previous` into a
 * const inside the effect BEFORE mutating the ref makes the ordering explicit
 * and irrecoverable-to-race.
 *
 * The `connectionKey` argument is any string that changes per fresh
 * connection (typically a caller-supplied nonce). Whenever it changes, the
 * baseline resets to null and the log clears, so a rejoin doesn't diff
 * against a stale count from the previous session.
 */
export function useMemberActivityLog(
  memberCount: number,
  connectionKey: string | null,
): UseMemberActivityLogResult {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [enabled, setEnabled] = useState<boolean>(() => getStoredSessionActivityEnabled());
  // Count seen the last time the delta-tracking effect ran. Null means "no
  // baseline yet for this connection" — the first count after reconnect must
  // never log a spurious event.
  const baselineRef = useRef<number | null>(null);

  // Reset whenever we switch to a new connection (or disconnect entirely).
  // Runs BEFORE the memberCount effect below on the same commit — React fires
  // effects in the order they're declared — so if both `connectionKey` and
  // `memberCount` change in the same render (e.g. a reconnect that flips
  // count from 3 → 0 → 1), the baseline is null when the delta effect reads
  // it and no bogus event fires.
  useEffect(() => {
    baselineRef.current = null;
    setEvents([]);
  }, [connectionKey]);

  // Derive events from member-count deltas. Capture the previous baseline
  // into a local const BEFORE mutating the ref — see the class comment above
  // for the race this avoids.
  useEffect(() => {
    const previous = baselineRef.current;
    baselineRef.current = memberCount;
    setEvents((log) => appendActivityEvent(log, previous, memberCount));
  }, [memberCount]);

  const onToggle = (): void => {
    setEnabled((prev) => {
      const next = !prev;
      setStoredSessionActivityEnabled(next);
      return next;
    });
  };

  return { events, enabled, onToggle };
}
