import { describe, expect, it } from 'vitest';
import { SESSION_CODE_REGEX } from './url-session.js';

// Note: the DOM-touching helpers (readCodeFromHash, writeCodeToHash, etc.)
// are exercised by hand and via the SessionPanel integration in dev/build.
// We don't pull jsdom in just for them — the regex is the only piece worth
// testing in isolation, and it's the one most likely to drift from the
// worker's CODE_ALPHABET.

describe('SESSION_CODE_REGEX', () => {
  it('accepts codes built from the worker alphabet', () => {
    expect(SESSION_CODE_REGEX.test('ABCD')).toBe(true);
    expect(SESSION_CODE_REGEX.test('K7P3')).toBe(true);
    expect(SESSION_CODE_REGEX.test('2345')).toBe(true);
    expect(SESSION_CODE_REGEX.test('XYZ9')).toBe(true);
  });
  it('rejects the visually-ambiguous characters O/0/I/1/L', () => {
    expect(SESSION_CODE_REGEX.test('OABC')).toBe(false);
    expect(SESSION_CODE_REGEX.test('A0CD')).toBe(false);
    expect(SESSION_CODE_REGEX.test('IBCD')).toBe(false);
    expect(SESSION_CODE_REGEX.test('A1CD')).toBe(false);
    expect(SESSION_CODE_REGEX.test('LBCD')).toBe(false);
  });
  it('rejects wrong lengths and lower case', () => {
    expect(SESSION_CODE_REGEX.test('ABC')).toBe(false);
    expect(SESSION_CODE_REGEX.test('ABCDE')).toBe(false);
    expect(SESSION_CODE_REGEX.test('abcd')).toBe(false);
    expect(SESSION_CODE_REGEX.test('')).toBe(false);
  });
});
