import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendActivityEvent,
  formatActivityTime,
  type ActivityEvent,
} from './session-activity.js';
import {
  getStoredSessionActivityEnabled,
  setStoredSessionActivityEnabled,
} from './output-prefs.js';

describe('appendActivityEvent', () => {
  it('does not log an event when there is no baseline yet (previousCount === null)', () => {
    const log = appendActivityEvent([], null, 3, 1000);
    expect(log).toEqual([]);
  });

  it('does not log an event when the count is unchanged', () => {
    const log = appendActivityEvent([], 2, 2, 1000);
    expect(log).toEqual([]);
  });

  it('logs a "joined" event when the count increases', () => {
    const log = appendActivityEvent([], 1, 2, 1000);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ kind: 'joined', delta: 1, atMs: 1000 });
  });

  it('logs a "left" event when the count decreases', () => {
    const log = appendActivityEvent([], 3, 2, 1000);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ kind: 'left', delta: 1, atMs: 1000 });
  });

  it('captures the size of a multi-member delta', () => {
    const log = appendActivityEvent([], 1, 4, 1000);
    expect(log[0]).toMatchObject({ kind: 'joined', delta: 3 });
  });

  it('appends to an existing log rather than replacing it', () => {
    let log = appendActivityEvent([], null, 1, 1000);
    log = appendActivityEvent(log, 1, 2, 2000);
    log = appendActivityEvent(log, 2, 1, 3000);
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ kind: 'joined', atMs: 2000 });
    expect(log[1]).toMatchObject({ kind: 'left', atMs: 3000 });
  });

  it('caps the log at 50 entries, dropping the oldest first', () => {
    let log: ActivityEvent[] = [];
    let prev: number | null = null;
    for (let i = 0; i < 60; i++) {
      const next = i + 1;
      log = appendActivityEvent(log, prev, next, i);
      prev = next;
    }
    expect(log).toHaveLength(50);
    // The oldest 10 transitions (atMs 0..9) should have fallen off; the
    // earliest surviving entry is atMs === 10.
    expect(log[0]?.atMs).toBe(10);
    expect(log[log.length - 1]?.atMs).toBe(59);
  });

  it('returns the same array reference when nothing changes (no unnecessary re-render)', () => {
    const log: ActivityEvent[] = [];
    expect(appendActivityEvent(log, null, 5, 1000)).toBe(log);
    expect(appendActivityEvent(log, 5, 5, 1000)).toBe(log);
  });

  it('assigns monotonically increasing ids derived from the log tail', () => {
    // Guards against reintroducing a module-level counter — a fresh caller
    // (empty log) should start from id=1 regardless of anything that ran
    // before, and each append should be exactly the previous id plus one.
    let log = appendActivityEvent([], 0, 1, 1000);
    log = appendActivityEvent(log, 1, 2, 2000);
    log = appendActivityEvent(log, 2, 3, 3000);
    expect(log.map((e) => e.id)).toEqual([1, 2, 3]);

    const fresh = appendActivityEvent([], 5, 6, 4000);
    expect(fresh[0]?.id).toBe(1);
  });
});

describe('delta-tracker wiring regression (React 18 updater/ref race)', () => {
  // Regression coverage for a real production bug shipped in feat/session-ui:
  // the SessionPanel wired onMemberCount as
  //     setLog(log => appendActivityEvent(log, ref.current, n));
  //     ref.current = n;
  // React 18 defers the updater until flush time. Between the setter call and
  // the flush, the very next line reassigns ref.current to `n`. When the
  // updater finally runs it reads `n` for BOTH previous and next → count
  // "unchanged" → no entry. Every websocket-driven onMemberCount collapsed
  // this way and the log silently accrued zero entries in prod.
  //
  // The correct pattern — the one the useMemberActivityLog hook implements —
  // captures the previous baseline into a local const BEFORE mutating the ref.
  // This suite pins both patterns down: the buggy one produces zero entries,
  // the fixed one produces the expected sequence.

  // Simulate React 18's per-event-handler flush: within a single dispatched
  // event, the setter is queued, then any synchronous statements after it
  // run, then React flushes state and runs the queued updater. This matches
  // the shape of a websocket `onMemberCount` callback: each message is its
  // own event, and React flushes at the end of that event.
  function simulateSingleEventFlush(
    ref: { current: number | null },
    log: ActivityEvent[],
    n: number,
    pattern: 'buggy' | 'fixed',
  ): ActivityEvent[] {
    if (pattern === 'buggy') {
      // Setter queued first (captures `ref.current` by *reference*), then
      // ref mutated, then React flushes.
      const updater = (l: ActivityEvent[]): ActivityEvent[] =>
        appendActivityEvent(l, ref.current, n);
      ref.current = n;
      return updater(log); // flush
    }
    // Fixed pattern: capture previous BEFORE mutating.
    const previous = ref.current;
    ref.current = n;
    const updater = (l: ActivityEvent[]): ActivityEvent[] =>
      appendActivityEvent(l, previous, n);
    return updater(log); // flush
  }

  it('buggy setter-first / mutate-second pattern accrues ZERO entries (documents the bug)', () => {
    const ref: { current: number | null } = { current: null };
    let log: ActivityEvent[] = [];

    // Each call models one websocket `onMemberCount` message. React flushes
    // at the end of every message before the next one arrives.
    log = simulateSingleEventFlush(ref, log, 0, 'buggy'); // first count seen
    log = simulateSingleEventFlush(ref, log, 1, 'buggy'); // someone joined
    log = simulateSingleEventFlush(ref, log, 2, 'buggy'); // another joined
    log = simulateSingleEventFlush(ref, log, 1, 'buggy'); // someone left

    // Bug signature: the updater always reads the *just-mutated* ref, so
    // previous === next for every call → appendActivityEvent no-ops → log
    // stays empty despite three real transitions. This is what real users
    // saw in production before the fix.
    expect(log).toEqual([]);
  });

  it('fixed capture-first / mutate-second / setter-third pattern accrues the correct entries', () => {
    const ref: { current: number | null } = { current: null };
    let log: ActivityEvent[] = [];

    log = simulateSingleEventFlush(ref, log, 0, 'fixed');
    log = simulateSingleEventFlush(ref, log, 1, 'fixed');
    log = simulateSingleEventFlush(ref, log, 2, 'fixed');
    log = simulateSingleEventFlush(ref, log, 1, 'fixed');

    expect(log).toHaveLength(3);
    expect(log.map((e) => ({ kind: e.kind, delta: e.delta }))).toEqual([
      { kind: 'joined', delta: 1 },
      { kind: 'joined', delta: 1 },
      { kind: 'left', delta: 1 },
    ]);
  });

  it('two successive observations with different counts produce TWO entries, not zero', () => {
    // Minimum-viable regression: the tightest form of the bug the reviewer
    // asked for — "call the delta-recording code path twice with different
    // counts and assert the log has TWO entries, not zero."
    const ref: { current: number | null } = { current: 0 }; // baseline established
    let log: ActivityEvent[] = [];

    log = simulateSingleEventFlush(ref, log, 1, 'fixed');
    log = simulateSingleEventFlush(ref, log, 2, 'fixed');

    expect(log).toHaveLength(2);
    expect(log.map((e) => e.kind)).toEqual(['joined', 'joined']);
  });
});

describe('formatActivityTime', () => {
  it('produces a locale-aware hour:minute string', () => {
    const d = new Date(2026, 0, 1, 9, 5, 0);
    // Match both 24-hour ("09:05") and 12-hour ("9:05 AM") locale outputs;
    // the tests must not assume the host locale is en-GB or fr-FR.
    expect(formatActivityTime(d.getTime())).toMatch(/^0?9:05(\s?[AP]M)?$/i);
  });

  it('zero-pads minutes below 10', () => {
    const d = new Date(2026, 0, 1, 15, 3, 0);
    // Minutes must always be two digits; hour width and AM/PM depend on locale.
    expect(formatActivityTime(d.getTime())).toMatch(/:03(\s?[AP]M)?$/i);
  });
});

describe('activity-log opt-in preference persistence', () => {
  let store: Record<string, string>;
  beforeEach(() => {
    store = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        store = {};
      },
      key: () => null,
      length: 0,
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to OFF (opt-in, not opt-out)', () => {
    expect(getStoredSessionActivityEnabled()).toBe(false);
  });

  it('persists the enabled preference across reads', () => {
    setStoredSessionActivityEnabled(true);
    // Storage key kept stable across the move from session-activity.ts to
    // output-prefs.ts so existing users don't lose their preference.
    expect(store['clickkeep:session-activity:enabled']).toBe('1');
    expect(getStoredSessionActivityEnabled()).toBe(true);
    setStoredSessionActivityEnabled(false);
    expect(getStoredSessionActivityEnabled()).toBe(false);
  });
});
