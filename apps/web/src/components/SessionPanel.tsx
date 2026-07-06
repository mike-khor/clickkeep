import { useEffect, useRef, useState } from 'react';
import { SessionClient } from '../lib/session-client.js';
import { useMetronome, type SessionRole } from '../lib/store.js';
import type { SessionState } from '@clickkeep/sync-core';
import {
  clearHash,
  forgetOwnerSecret,
  readCodeFromHash,
  recallOwnerSecret,
  rememberOwnerSecret,
  writeCodeToHash,
} from '../lib/url-session.js';
import { COPY } from '../copy/strings.js';
import { Sheet } from './Sheet.js';

const WORKER_URL = (import.meta.env.VITE_SESSION_WORKER_URL as string | undefined) ?? 'http://localhost:8787';

// Same alphabet the worker uses (no I, L, O, 0, 1).
const VALID_CHAR = /[A-HJ-KM-NP-Z2-9]/i;
const CODE_LEN = 4;

interface CreatedSession {
  code: string;
  sessionId: string;
  ownerSecret: string;
}

type Status = 'idle' | 'connecting' | 'connected' | 'error';

/**
 * Owns the session connection state AND renders the trigger pill + Sheet.
 *
 * The trigger lives in the main toolbar; tapping it opens the sheet. When
 * connected, the trigger flips to show the live code and member count so the
 * user always sees session state at a glance without opening the sheet.
 */
export function SessionPanel(): JSX.Element {
  const [code, setCode] = useState('');
  const [created, setCreated] = useState<CreatedSession | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [memberCount, setMemberCount] = useState(0);
  const [rttMs, setRttMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [client, setClient] = useState<SessionClient | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const setSessionRole = useMetronome((s) => s.setSessionRole);
  const sessionRole = useMetronome((s) => s.sessionRole);
  // Tracks the code of the connection we *automatically* started from the URL
  // on mount. Used to decide whether to drop a stale owner secret when the
  // worker rejects the auto-rejoin's `claim-owner`. We deliberately do NOT
  // clear the URL on every error: transient socket failures and `bad-secret`
  // both still leave a live session the user can re-join as a member.
  const autoConnectCodeRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      client?.close();
    };
  }, [client]);

  // Owner broadcasts local store changes (BPM / signature / play-stop) to the
  // worker so members follow. We subscribe to the store directly instead of
  // listing bpm / beatsPerBar / isPlaying in the effect deps so the
  // subscription is set up once per session and isn't re-created on every
  // keystroke. The `last` snapshot dedupes: zustand fires `subscribe` on
  // every store update (including the per-beat `setCurrentBeat` from the
  // click scheduler), but we only want a wire message when the owner-driven
  // fields actually change.
  useEffect(() => {
    if (client === null) return;
    let last: { bpm: number; beatsPerBar: number; isPlaying: boolean } | null = null;
    const send = (state: { bpm: number; beatsPerBar: number; isPlaying: boolean }): void => {
      // Single-song "default" until Concert Mode lands; the worker stamps
      // sessionId + version, we just supply the slice that changed.
      // The owner stamps its own sessionAnchorMs to the same value it broadcasts,
      // so its local scheduler and every member's scheduler anchor beat 0 to the
      // same wall-clock instant.
      let playback: { kind: 'playing'; songId: string; anchorServerTime: number } | { kind: 'stopped' };
      if (state.isPlaying) {
        const anchor = Date.now();
        useMetronome.getState().setSessionAnchorMs(anchor);
        playback = { kind: 'playing', songId: 'default', anchorServerTime: anchor };
      } else {
        useMetronome.getState().setSessionAnchorMs(null);
        playback = { kind: 'stopped' };
      }
      const setlist = [
        {
          id: 'default',
          title: 'Untitled',
          tempo: [{ startAt: 0, bpm: state.bpm, beatsPerBar: state.beatsPerBar }],
        },
      ];
      client.send({ t: 'set-state', state: { playback, setlist } });
    };
    const unsub = useMetronome.subscribe((s) => {
      if (s.sessionRole !== 'owner') {
        last = null;
        return;
      }
      const snap = { bpm: s.bpm, beatsPerBar: s.beatsPerBar, isPlaying: s.isPlaying };
      if (
        last !== null &&
        last.bpm === snap.bpm &&
        last.beatsPerBar === snap.beatsPerBar &&
        last.isPlaying === snap.isPlaying
      ) {
        return;
      }
      last = snap;
      send(snap);
    });
    return unsub;
  }, [client]);

  const applyIncomingState = (state: SessionState): void => {
    // Members mirror the owner's tempo and play state. Owners ignore their own
    // echoed state — applying it would re-trigger the broadcast effect above
    // and bounce a fresh anchorServerTime back out for no reason.
    if (useMetronome.getState().sessionRole !== 'member') return;
    const first = state.setlist[0]?.tempo[0];
    if (first === undefined) return;
    const isPlaying = state.playback.kind === 'playing';
    const sessionAnchorMs =
      state.playback.kind === 'playing' ? state.playback.anchorServerTime : null;
    useMetronome.setState({
      bpm: first.bpm,
      beatsPerBar: first.beatsPerBar,
      isPlaying,
      sessionAnchorMs,
    });
  };

  const connect = (codeToUse: string, ownerSecret: string | null): void => {
    setStatus('connecting');
    // Optimistically reflect the intended role; the worker is the final word —
    // if it rejects ownership (claim-owner failure) onError will flip us back.
    setSessionRole(ownerSecret !== null ? 'owner' : 'member');
    const wsScheme = WORKER_URL.startsWith('https') ? 'wss' : 'ws';
    const wsUrl = `${WORKER_URL.replace(/^https?/, wsScheme)}/sessions/${codeToUse}/ws`;
    const c = new SessionClient(wsUrl, ownerSecret, {
      onState: applyIncomingState,
      onMemberCount: setMemberCount,
      onClockEstimate: (e) => {
        setStatus('connected');
        setRttMs(Math.round(e.rttMs));
      },
      onError: (errCode, msg) => {
        // On `bad-secret` during auto-rejoin: the stored owner secret is stale
        // (or never belonged to this session in the first place — codes can be
        // recycled). Forget it so future reloads don't keep trying to claim
        // owner, drop the optimistic "you are the owner" badge, and demote to
        // member — the session itself is alive and we stay connected to it.
        // For every other error (`socket` blips, `internal`, etc.) treat the
        // failure as transient: surface the message but don't touch URL or
        // storage, and fall back to solo since the connection itself is
        // likely going down (onClose will fire shortly).
        if (autoConnectCodeRef.current === codeToUse && errCode === 'bad-secret') {
          forgetOwnerSecret(codeToUse);
          setCreated(null);
          autoConnectCodeRef.current = null;
          setError('Owner credentials no longer valid — joined as member.');
          setSessionRole('member');
        } else {
          setError(msg);
          setSessionRole('solo');
        }
        setStatus('error');
      },
      onClose: () => {
        setStatus('idle');
        setSessionRole('solo');
      },
    });
    setClient(c);
  };

  // On mount: if the URL already has a valid session code, try to rejoin it.
  // If sessionStorage also has the matching owner secret, we'll reclaim owner
  // status — otherwise we join as a member.
  useEffect(() => {
    const codeFromUrl = readCodeFromHash();
    if (codeFromUrl === null) return;
    const credential = recallOwnerSecret(codeFromUrl);
    setCode(codeFromUrl);
    autoConnectCodeRef.current = codeFromUrl;
    if (credential !== null) {
      // We have a credential stashed, so we *believe* we're the owner. Surface
      // that in the UI right away by setting `created` — the actual ownership
      // claim happens inside SessionClient.onOpen via claim-owner.
      setCreated({
        code: codeFromUrl,
        sessionId: credential.sessionId,
        ownerSecret: credential.secret,
      });
    }
    connect(codeFromUrl, credential?.secret ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional mount-only
  }, []);

  const handleCreate = async (): Promise<void> => {
    setError(null);
    try {
      const res = await fetch(`${WORKER_URL}/sessions`, { method: 'POST' });
      if (!res.ok) throw new Error(`Create failed: ${res.status}`);
      const body = (await res.json()) as CreatedSession;
      setCreated(body);
      setCode(body.code);
      writeCodeToHash(body.code);
      rememberOwnerSecret(body.code, body.sessionId, body.ownerSecret);
      connect(body.code, body.ownerSecret);
    } catch (e) {
      setError(String(e));
      setStatus('error');
      setSessionRole('solo');
    }
  };

  const handleJoin = (joinCode: string): void => {
    setError(null);
    if (joinCode.length < CODE_LEN) {
      setError(COPY.session.needFour);
      return;
    }
    const upper = joinCode.toUpperCase();
    writeCodeToHash(upper);
    connect(upper, null);
  };

  const handleLeave = (): void => {
    client?.close();
    setClient(null);
    if (code) forgetOwnerSecret(code);
    clearHash();
    autoConnectCodeRef.current = null;
    setCreated(null);
    setCode('');
    setMemberCount(0);
    setRttMs(null);
    setStatus('idle');
    setSessionRole('solo');
  };

  const handleCopy = async (): Promise<void> => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard refused — fall back to a transient selection so the user can
      // still hit Cmd-C. Failure here is rare and recoverable.
      setCopied(false);
    }
  };

  const handleShare = async (): Promise<void> => {
    if (!code) return;
    const url = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}#${code}` : code;
    try {
      await navigator.share({
        title: 'ClickKeep session',
        text: `Join my ClickKeep session: ${code}`,
        url,
      });
    } catch {
      // User cancelled or the API isn't available — nothing to surface.
    }
  };

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const isConnected = status === 'connected' || status === 'connecting';

  return (
    <>
      <SessionTrigger
        isConnected={isConnected}
        connecting={status === 'connecting'}
        code={code}
        memberCount={memberCount}
        sessionRole={sessionRole}
        onOpen={() => setOpen(true)}
      />
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={isConnected ? COPY.session.codeLabel : 'Session'}
        subtitle={
          isConnected
            ? status === 'connected' && rttMs !== null
              ? `Live · ${rttMs} ms round-trip`
              : 'Connecting…'
            : COPY.session.createBlurb
        }
      >
        {isConnected ? (
          <ConnectedView
            code={code}
            memberCount={memberCount}
            sessionRole={sessionRole}
            copied={copied}
            canShare={canShare}
            onCopy={handleCopy}
            onShare={handleShare}
            onLeave={() => {
              handleLeave();
              setOpen(false);
            }}
            error={error}
          />
        ) : (
          <DisconnectedView
            onCreate={() => {
              void handleCreate();
            }}
            onJoin={handleJoin}
            initialCode={code}
            error={error}
          />
        )}
      </Sheet>
    </>
  );
}

interface TriggerProps {
  isConnected: boolean;
  connecting: boolean;
  code: string;
  memberCount: number;
  sessionRole: SessionRole;
  onOpen: () => void;
}

function SessionTrigger({ isConnected, connecting, code, memberCount, sessionRole, onOpen }: TriggerProps): JSX.Element {
  if (!isConnected) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex items-center gap-2 rounded-full border border-ink-200 dark:border-ink-700 bg-transparent px-4 py-2 text-sm font-medium hover:bg-ink-100 dark:hover:bg-ink-800"
      >
        <PeopleIcon />
        {COPY.session.trigger}
      </button>
    );
  }
  const memberLabel = `${memberCount} ${memberCount === 1 ? COPY.session.membersOne : COPY.session.membersMany}`;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex items-center gap-2 rounded-full border border-ink-200 dark:border-ink-700 bg-ink-100 dark:bg-ink-800 px-3 py-2 text-sm"
      aria-label={`Session ${code}, ${memberLabel}. Tap to manage.`}
    >
      <span
        className={[
          'inline-block h-2 w-2 rounded-full',
          connecting ? 'bg-ink-400' : sessionRole === 'owner' ? 'bg-accent' : 'bg-green-500',
        ].join(' ')}
        aria-hidden="true"
      />
      <span className="font-semibold tabular-nums tracking-widest">{code}</span>
      <span className="text-ink-500 dark:text-ink-400">·</span>
      <span className="text-ink-600 dark:text-ink-300">{memberLabel}</span>
    </button>
  );
}

interface ConnectedViewProps {
  code: string;
  memberCount: number;
  sessionRole: SessionRole;
  copied: boolean;
  canShare: boolean;
  onCopy: () => void;
  onShare: () => void;
  onLeave: () => void;
  error: string | null;
}

function ConnectedView({
  code,
  memberCount,
  sessionRole,
  copied,
  canShare,
  onCopy,
  onShare,
  onLeave,
  error,
}: ConnectedViewProps): JSX.Element {
  const memberLabel = `${memberCount} ${memberCount === 1 ? COPY.session.membersOne : COPY.session.membersMany}`;
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl bg-ink-100 dark:bg-ink-800 p-5 text-center">
        <div className="text-[11px] uppercase tracking-widest text-ink-500 dark:text-ink-400">
          {COPY.session.codeLabel}
        </div>
        <div className="mt-2 text-5xl font-extrabold tabular-nums tracking-[0.35em]">{code}</div>
        <div className="mt-3 text-sm text-ink-500 dark:text-ink-400">
          {memberLabel}
          {sessionRole === 'owner' ? ` · ${COPY.session.ownerBadge}` : ''}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCopy}
          className="flex-1 rounded-xl bg-accent text-ink-900 px-4 py-3 text-sm font-semibold hover:bg-accent-600"
        >
          {copied ? COPY.session.copied : COPY.session.copy}
        </button>
        {canShare && (
          <button
            type="button"
            onClick={onShare}
            className="rounded-xl border border-ink-200 dark:border-ink-700 px-4 py-3 text-sm font-medium hover:bg-ink-100 dark:hover:bg-ink-800"
          >
            {COPY.session.share}
          </button>
        )}
      </div>

      {error !== null && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}

      <button
        type="button"
        onClick={onLeave}
        className="rounded-xl border border-ink-200 dark:border-ink-700 px-4 py-2.5 text-sm hover:bg-ink-100 dark:hover:bg-ink-800"
      >
        {COPY.session.leave}
      </button>
    </div>
  );
}

interface DisconnectedViewProps {
  onCreate: () => void;
  onJoin: (code: string) => void;
  initialCode: string;
  error: string | null;
}

function DisconnectedView({ onCreate, onJoin, initialCode, error }: DisconnectedViewProps): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-ink-500 dark:text-ink-400">
          {COPY.session.createTitle}
        </h3>
        <button
          type="button"
          onClick={onCreate}
          className="rounded-xl bg-accent text-ink-900 px-4 py-3 text-base font-semibold hover:bg-accent-600"
        >
          {COPY.session.create}
        </button>
      </section>

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-ink-200 dark:bg-ink-700" />
        <span className="text-[11px] uppercase tracking-widest text-ink-400">or</span>
        <div className="h-px flex-1 bg-ink-200 dark:bg-ink-700" />
      </div>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-ink-500 dark:text-ink-400">
          {COPY.session.joinTitle}
        </h3>
        <p className="text-sm text-ink-600 dark:text-ink-300">{COPY.session.joinBlurb}</p>
        <CodeCells initial={initialCode} onSubmit={onJoin} />
      </section>

      {error !== null && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}
    </div>
  );
}

interface CodeCellsProps {
  initial: string;
  onSubmit: (code: string) => void;
}

function CodeCells({ initial, onSubmit }: CodeCellsProps): JSX.Element {
  // Initialize from any pre-existing code (e.g. the URL hash).
  const init = sanitize(initial).padEnd(CODE_LEN, ' ').slice(0, CODE_LEN).split('');
  const [chars, setChars] = useState<string[]>(() => init.map((c) => (c === ' ' ? '' : c)));
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  const setChar = (i: number, raw: string): void => {
    const upper = raw.toUpperCase();
    // Only accept a single legal character; reject silently otherwise so the
    // input doesn't flash invalid text.
    if (upper.length > 0 && !VALID_CHAR.test(upper)) return;
    const next = chars.slice();
    next[i] = upper.slice(-1); // keep the latest legal char only
    setChars(next);
    if (upper.length > 0 && i < CODE_LEN - 1) {
      refs.current[i + 1]?.focus();
      refs.current[i + 1]?.select();
    }
  };

  const onPaste = (i: number, e: React.ClipboardEvent<HTMLInputElement>): void => {
    const pasted = sanitize(e.clipboardData.getData('text'));
    if (pasted.length === 0) return;
    e.preventDefault();
    const next = chars.slice();
    for (let k = 0; k < pasted.length && i + k < CODE_LEN; k++) {
      next[i + k] = pasted[k] ?? '';
    }
    setChars(next);
    const focusIdx = Math.min(i + pasted.length, CODE_LEN - 1);
    refs.current[focusIdx]?.focus();
    refs.current[focusIdx]?.select();
  };

  const onKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Backspace' && chars[i] === '' && i > 0) {
      e.preventDefault();
      const next = chars.slice();
      next[i - 1] = '';
      setChars(next);
      refs.current[i - 1]?.focus();
    } else if (e.key === 'ArrowLeft' && i > 0) {
      refs.current[i - 1]?.focus();
    } else if (e.key === 'ArrowRight' && i < CODE_LEN - 1) {
      refs.current[i + 1]?.focus();
    } else if (e.key === 'Enter') {
      submit();
    }
  };

  const submit = (): void => {
    const code = chars.join('').toUpperCase();
    onSubmit(code);
  };

  const complete = chars.every((c) => c !== '');
  const joined = chars.join('').toUpperCase();

  return (
    <div className="flex flex-col gap-3">
      {/* Single hidden input keeps the aria-label "Session code" reachable for
          existing E2E and assistive tech that prefer one form control over a
          row of single-char inputs. Mirrors the cell state. */}
      <input
        type="text"
        value={joined}
        onChange={(e) => {
          const sanitized = sanitize(e.target.value).slice(0, CODE_LEN);
          const next = Array.from({ length: CODE_LEN }, (_, k) => sanitized[k] ?? '');
          setChars(next);
        }}
        aria-label={COPY.session.codeLabel}
        className="sr-only"
        maxLength={CODE_LEN}
      />
      <div
        role="group"
        className="flex justify-between gap-2 sm:justify-center sm:gap-3"
      >
        {chars.map((c, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={1}
            value={c}
            onChange={(e) => setChar(i, e.target.value)}
            onPaste={(e) => onPaste(i, e)}
            onKeyDown={(e) => onKey(i, e)}
            onFocus={(e) => e.currentTarget.select()}
            aria-label={`${COPY.session.codeLabel} character ${i + 1}`}
            className={[
              'h-16 w-14 sm:h-16 sm:w-16 rounded-xl border-2 bg-transparent',
              'text-center text-3xl font-bold uppercase tabular-nums',
              c
                ? 'border-accent text-ink-900 dark:text-ink-50'
                : 'border-ink-200 dark:border-ink-700 text-ink-400',
              'focus:outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/40',
            ].join(' ')}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={!complete}
        className="rounded-xl bg-accent text-ink-900 px-4 py-3 text-base font-semibold hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent"
      >
        {COPY.session.join}
      </button>
    </div>
  );
}

function sanitize(s: string): string {
  return s
    .toUpperCase()
    .split('')
    .filter((c) => VALID_CHAR.test(c))
    .join('');
}

function PeopleIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3 3-5 6-5s6 2 6 5" />
      <circle cx="17" cy="9" r="2.2" />
      <path d="M15 14.5c2.5.2 5 1.8 5 4.5" />
    </svg>
  );
}
