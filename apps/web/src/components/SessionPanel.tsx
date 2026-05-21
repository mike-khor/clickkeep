import { useEffect, useRef, useState } from 'react';
import { SessionClient } from '../lib/session-client.js';
import { useMetronome } from '../lib/store.js';
import {
  clearHash,
  forgetOwnerSecret,
  readCodeFromHash,
  recallOwnerSecret,
  rememberOwnerSecret,
  writeCodeToHash,
} from '../lib/url-session.js';
import { COPY } from '../copy/strings.js';

const WORKER_URL = (import.meta.env.VITE_SESSION_WORKER_URL as string | undefined) ?? 'http://localhost:8787';

interface CreatedSession {
  code: string;
  sessionId: string;
  ownerSecret: string;
}

type Status = 'idle' | 'connecting' | 'connected' | 'error';

export function SessionPanel(): JSX.Element {
  const [code, setCode] = useState('');
  const [created, setCreated] = useState<CreatedSession | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [memberCount, setMemberCount] = useState(0);
  const [rttMs, setRttMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [client, setClient] = useState<SessionClient | null>(null);
  const setSessionRole = useMetronome((s) => s.setSessionRole);
  const sessionRole = useMetronome((s) => s.sessionRole);
  // Tracks the code of the connection we *automatically* started from the URL
  // on mount. Used to decide whether to drop a stale owner secret when the
  // worker rejects the auto-rejoin's `claim-owner`. We deliberately do NOT
  // clear the URL on every error: transient socket failures and `bad-secret`
  // both still leave a live session the user can re-join as a member.
  const autoConnectCodeRef = useRef<string | null>(null);
  // StrictMode double-runs the mount effect; this guard makes sure we don't
  // open two WebSockets to the same session on the first render.
  const didAutoConnectRef = useRef(false);

  useEffect(() => {
    return () => {
      client?.close();
    };
  }, [client]);

  // Whenever the panel unmounts entirely (route change, app teardown), drop
  // back to solo so a stale 'member' flag can't outlive the connection.
  useEffect(() => {
    return () => {
      setSessionRole('solo');
    };
  }, [setSessionRole]);

  const connect = (codeToUse: string, ownerSecret: string | null): void => {
    setStatus('connecting');
    // Optimistically reflect the intended role; the worker is the final word —
    // if it rejects ownership (claim-owner failure) onError will flip us back.
    setSessionRole(ownerSecret !== null ? 'owner' : 'member');
    const wsScheme = WORKER_URL.startsWith('https') ? 'wss' : 'ws';
    const wsUrl = `${WORKER_URL.replace(/^https?/, wsScheme)}/sessions/${codeToUse}/ws`;
    const c = new SessionClient(wsUrl, ownerSecret, {
      onState: () => {
        /* state handling lands with Concert Mode work */
      },
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
    if (didAutoConnectRef.current) return;
    didAutoConnectRef.current = true;
    const codeFromUrl = readCodeFromHash();
    if (codeFromUrl === null) return;
    const secret = recallOwnerSecret(codeFromUrl);
    setCode(codeFromUrl);
    autoConnectCodeRef.current = codeFromUrl;
    if (secret !== null) {
      // We have a secret stashed, so we *believe* we're the owner. Surface
      // that in the UI right away by setting `created` — the actual ownership
      // claim happens inside SessionClient.onOpen via claim-owner.
      setCreated({ code: codeFromUrl, sessionId: '', ownerSecret: secret });
    }
    connect(codeFromUrl, secret);
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
      rememberOwnerSecret(body.code, body.ownerSecret);
      connect(body.code, body.ownerSecret);
    } catch (e) {
      setError(String(e));
      setStatus('error');
      setSessionRole('solo');
    }
  };

  const handleJoin = (): void => {
    setError(null);
    if (code.length < 4) {
      setError('Code must be 4 characters');
      return;
    }
    const upper = code.toUpperCase();
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

  if (status === 'connected' || status === 'connecting') {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-ink-200 dark:border-ink-700 p-4 min-w-[280px]">
        <div className="flex items-baseline justify-between">
          <div className="text-xs uppercase tracking-widest text-ink-500 dark:text-ink-400">
            {COPY.session.codeLabel}
          </div>
          <span
            className={[
              'text-xs px-2 py-0.5 rounded-full',
              status === 'connected'
                ? 'bg-green-500/15 text-green-600 dark:text-green-400'
                : 'bg-ink-200 dark:bg-ink-700 text-ink-600 dark:text-ink-300',
            ].join(' ')}
          >
            {status === 'connected' ? `${rttMs}ms` : 'connecting…'}
          </span>
        </div>
        <div className="text-4xl font-bold tracking-[0.3em] tabular-nums">{code}</div>
        <div className="text-sm text-ink-500 dark:text-ink-400">
          {memberCount} {memberCount === 1 ? COPY.session.membersOne : COPY.session.membersMany}
          {sessionRole === 'owner' ? ` • ${COPY.session.ownerBadge}` : ''}
        </div>
        <button
          type="button"
          onClick={handleLeave}
          className="rounded-md border border-ink-200 dark:border-ink-700 px-3 py-1.5 text-sm hover:bg-ink-100 dark:hover:bg-ink-800"
        >
          {COPY.session.leave}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-ink-200 dark:border-ink-700 p-4 min-w-[280px]">
      <button
        type="button"
        onClick={handleCreate}
        className="rounded-md bg-accent text-ink-900 px-3 py-2 text-sm font-medium hover:bg-accent-600"
      >
        {COPY.session.create}
      </button>
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-ink-200 dark:bg-ink-700" />
        <span className="text-xs uppercase tracking-widest text-ink-400">or</span>
        <div className="h-px flex-1 bg-ink-200 dark:bg-ink-700" />
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))}
          placeholder={COPY.session.codePlaceholder}
          maxLength={4}
          className="flex-1 rounded-md border border-ink-200 dark:border-ink-700 bg-transparent px-3 py-2 text-lg tracking-[0.3em] tabular-nums uppercase"
          aria-label={COPY.session.codeLabel}
        />
        <button
          type="button"
          onClick={handleJoin}
          disabled={code.length < 4}
          className="rounded-md border border-ink-200 dark:border-ink-700 px-3 py-2 text-sm disabled:opacity-40 hover:bg-ink-100 dark:hover:bg-ink-800"
        >
          {COPY.session.join}
        </button>
      </div>
      {error !== null && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}
    </div>
  );
}
