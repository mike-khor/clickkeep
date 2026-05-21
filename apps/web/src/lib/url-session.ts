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
// Codes are 4 chars from a 31-symbol alphabet (~923k combinations), so
// recycling is inevitable on a long enough timeline. Self-evicting after
// 24h means a stale bundle can't outlive any plausible single session
// and can't follow a recycled code into someone else's room.
const SECRET_TTL_MS = 24 * 60 * 60 * 1000;

export interface OwnerCredential {
  sessionId: string;
  secret: string;
}

interface StoredCredential extends OwnerCredential {
  expiresAt: number;
}

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
 * Stash the owner credential for `code` in sessionStorage. Bundles the
 * server-side `sessionId` alongside the secret so we can tell apart "I own
 * this session" from "this code now belongs to a different session and my
 * stored secret is for the old one." Survives reload, dies with the tab,
 * and self-evicts after `SECRET_TTL_MS`.
 */
export function rememberOwnerSecret(code: string, sessionId: string, secret: string): void {
  if (typeof window === 'undefined') return;
  const bundle: StoredCredential = { sessionId, secret, expiresAt: Date.now() + SECRET_TTL_MS };
  try {
    window.sessionStorage.setItem(SECRET_KEY_PREFIX + code, JSON.stringify(bundle));
  } catch {
    // sessionStorage can throw in private mode / quota-full; ignore — worst
    // case the owner just loses owner status on refresh, same as today.
  }
}

/**
 * Return the stored owner credential for `code`, or `null` if there isn't one
 * (or it has expired, or it's in the old plain-string format from before the
 * bundle landed). Expired/legacy entries are evicted as a side effect.
 */
export function recallOwnerSecret(code: string): OwnerCredential | null {
  if (typeof window === 'undefined') return null;
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(SECRET_KEY_PREFIX + code);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let parsed: StoredCredential;
  try {
    parsed = JSON.parse(raw) as StoredCredential;
  } catch {
    // Legacy plain-string secret from before the bundle landed — can't trust
    // it (no sessionId, no TTL), so evict and treat as missing.
    forgetOwnerSecret(code);
    return null;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof parsed.sessionId !== 'string' ||
    typeof parsed.secret !== 'string' ||
    typeof parsed.expiresAt !== 'number'
  ) {
    forgetOwnerSecret(code);
    return null;
  }
  if (parsed.expiresAt <= Date.now()) {
    forgetOwnerSecret(code);
    return null;
  }
  return { sessionId: parsed.sessionId, secret: parsed.secret };
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
