import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendActivityEvent,
  formatActivityTime,
  getStoredActivityEnabled,
  setStoredActivityEnabled,
  type ActivityEvent,
} from './session-activity.js';

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
});

describe('formatActivityTime', () => {
  it('formats as zero-padded 24h HH:MM', () => {
    const d = new Date(2026, 0, 1, 9, 5, 0);
    expect(formatActivityTime(d.getTime())).toBe('09:05');
  });

  it('pads single-digit hours and minutes', () => {
    const d = new Date(2026, 0, 1, 0, 0, 0);
    expect(formatActivityTime(d.getTime())).toBe('00:00');
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
    expect(getStoredActivityEnabled()).toBe(false);
  });

  it('persists the enabled preference across reads', () => {
    setStoredActivityEnabled(true);
    expect(store['clickkeep:session-activity:enabled']).toBe('1');
    expect(getStoredActivityEnabled()).toBe(true);
    setStoredActivityEnabled(false);
    expect(getStoredActivityEnabled()).toBe(false);
  });
});
