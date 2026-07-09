import { useRef } from 'react';

/**
 * Mirror a value into a mutable ref so a long-lived callback (audio scheduler,
 * event listener, timer) can read the latest render's value without triggering
 * a rebind of the callback on every change.
 *
 * The pattern replaces the four-line "declare state, declare ref, assign into
 * ref every render" boilerplate that was scattered through the metronome
 * engine — one call site per piece of state instead of three lines each.
 */
export function useLatestRef<T>(value: T): { current: T } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
