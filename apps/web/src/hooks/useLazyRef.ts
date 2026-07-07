import { useRef } from 'react';

/**
 * Like `useRef(factory())` but the factory runs exactly once, on the first
 * render. Useful when the factory allocates something expensive or has a
 * side effect (e.g. looking up a runtime plugin) that must not repeat.
 *
 * `undefined` is used as the "not yet computed" sentinel so `null` can be a
 * legal factory result — the native-metronome lookup returns `null` in
 * plain browsers and we still want to memoize that verdict.
 */
export function useLazyRef<T>(factory: () => T): { current: T } {
  const ref = useRef<T | undefined>(undefined);
  if (ref.current === undefined) {
    ref.current = factory();
  }
  return ref as { current: T };
}
