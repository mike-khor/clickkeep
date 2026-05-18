// Persistence of "which session am I in" lives in the URL hash fragment so a
// page refresh keeps the user connected. This honours the anonymous-by-default
// invariant in CLAUDE.md: there is no server-side user record — the URL itself
// is the identity.
//
// The owner secret is a different problem. It must NOT live in the URL (anyone
// the URL is shared with would become owner), but losing it on refresh would
// make a single accidental Cmd-R drop you out of "owner" mode mid-show. So we
// stash it in sessionStorage, scoped to the join code. sessionStorage survives
// reload but not tab close — which matches the "you opened it, you control it"
// semantics: as long as the tab is alive, you're still the owner.

/** Valid session-code regex. Matches the worker's `CODE_ALPHABET` exactly
 *  (`ABCDEFGHJKMNPQRSTUVWXYZ23456789` — no I/L/O, no 0/1). */
export const SESSION_CODE_REGEX = /^[A-HJKMNP-Z2-9]{4}$/;

const SECRET_KEY_PREFIX = 'clickkeep:secret:';

/**
 * Read a session code from the current URL hash. Returns `null` if the hash is
 * empty or doesn't match the valid-code shape (so the address bar can't be
 * tricked into auto-connecting to garbage).
 */
export function readCodeFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = window.location.hash.replace(/^#/, '').toUpperCase();
  if (raw.length === 0) return null;
  return SESSION_CODE_REGEX.test(raw) ? raw : null;
}

/**
 * Write `#CODE` to the URL without adding a history entry (replaceState).
 * No-op outside a browser.
 */
export function writeCodeToHash(code: string): void {
  if (typeof window === 'undefined') return;
  window.history.replaceState(null, '', '#' + code);
}

/**
 * Strip the hash fragment from the URL without adding a history entry.
 * Preserves pathname and search.
 */
export function clearHash(): void {
  if (typeof window === 'undefined') return;
  const { pathname, search } = window.location;
  window.history.replaceState(null, '', pathname + search);
}

/**
 * Stash the owner secret for `code` in sessionStorage. Survives reload of the
 * tab, dies with the tab — exactly the lifetime we want for owner identity.
 */
export function rememberOwnerSecret(code: string, secret: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SECRET_KEY_PREFIX + code, secret);
  } catch {
    // sessionStorage can throw in private mode / quota-full; ignore — worst
    // case the owner just loses owner status on refresh, same as today.
  }
}

/** Return the stored owner secret for `code`, or `null` if there isn't one. */
export function recallOwnerSecret(code: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(SECRET_KEY_PREFIX + code);
  } catch {
    return null;
  }
}

/** Forget the owner secret for `code`. Called on explicit Leave. */
export function forgetOwnerSecret(code: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(SECRET_KEY_PREFIX + code);
  } catch {
    // ignore
  }
}
