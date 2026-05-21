import { useEffect, useState } from 'react';
import { SessionClient } from '../lib/session-client.js';
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

  useEffect(() => {
    return () => {
      client?.close();
    };
  }, [client]);

  const connect = (codeToUse: string, ownerSecret: string | null): void => {
    setStatus('connecting');
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
      onError: (_code, msg) => {
        setError(msg);
        setStatus('error');
      },
      onClose: () => setStatus('idle'),
    });
    setClient(c);
  };

  const handleCreate = async (): Promise<void> => {
    setError(null);
    try {
      const res = await fetch(`${WORKER_URL}/sessions`, { method: 'POST' });
      if (!res.ok) throw new Error(`Create failed: ${res.status}`);
      const body = (await res.json()) as CreatedSession;
      setCreated(body);
      setCode(body.code);
      connect(body.code, body.ownerSecret);
    } catch (e) {
      setError(String(e));
      setStatus('error');
    }
  };

  const handleJoin = (): void => {
    setError(null);
    if (code.length < 4) {
      setError('Code must be 4 characters');
      return;
    }
    connect(code.toUpperCase(), null);
  };

  const handleLeave = (): void => {
    client?.close();
    setClient(null);
    setCreated(null);
    setCode('');
    setMemberCount(0);
    setRttMs(null);
    setStatus('idle');
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
          {created ? ' • you are the owner' : ''}
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
