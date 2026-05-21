// AGENT_GUARDRAIL: this Durable Object holds the canonical state for a session.
// All sync correctness flows through this file. Tier 3.

import type { ClientMessage, ServerMessage, SessionState } from '@clickkeep/sync-core';

interface InitPayload {
  sessionId: string;
  ownerSecret: string;
}

interface MemberSocket {
  socket: WebSocket;
  memberId: string;
  isOwner: boolean;
}

const DEFAULT_STATE = (sessionId: string): SessionState => ({
  sessionId,
  playback: { kind: 'stopped' },
  setlist: [
    {
      id: 'default',
      title: 'Untitled',
      tempo: [{ startAt: 0, bpm: 120, beatsPerBar: 4 }],
    },
  ],
  version: 0,
});

export class SessionDO implements DurableObject {
  private state: DurableObjectState;
  private sockets = new Map<WebSocket, MemberSocket>();
  private sessionState: SessionState | null = null;
  private ownerSecret: string | null = null;
  private sessionId: string | null = null;

  constructor(state: DurableObjectState) {
    this.state = state;
    void this.state.blockConcurrencyWhile(async () => {
      this.sessionState = (await this.state.storage.get<SessionState>('state')) ?? null;
      this.ownerSecret = (await this.state.storage.get<string>('ownerSecret')) ?? null;
      this.sessionId = (await this.state.storage.get<string>('sessionId')) ?? null;
    });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === 'POST' && url.pathname === '/init') {
      const body = (await req.json()) as InitPayload;
      this.sessionId = body.sessionId;
      this.ownerSecret = body.ownerSecret;
      this.sessionState = DEFAULT_STATE(body.sessionId);
      await this.state.storage.put('sessionId', body.sessionId);
      await this.state.storage.put('ownerSecret', body.ownerSecret);
      await this.state.storage.put('state', this.sessionState);
      return new Response('ok');
    }

    // WebSocket upgrade.
    if (req.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.handleSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('Not found', { status: 404 });
  }

  private handleSocket(socket: WebSocket): void {
    socket.accept();
    const memberId = crypto.randomUUID();
    const member: MemberSocket = { socket, memberId, isOwner: false };
    this.sockets.set(socket, member);

    const send = (msg: ServerMessage): void => {
      try {
        socket.send(JSON.stringify(msg));
      } catch {
        // Socket closed during send — cleanup handled by close handler.
      }
    };

    send({
      t: 'welcome',
      sessionId: this.sessionId ?? '',
      memberId,
      serverTime: Date.now(),
      isOwner: false,
    });
    if (this.sessionState) send({ t: 'state', state: this.sessionState });
    this.broadcastMemberCount();

    socket.addEventListener('message', (event) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(typeof event.data === 'string' ? event.data : '');
      } catch {
        send({ t: 'error', code: 'bad-json', message: 'Could not parse message' });
        return;
      }
      this.handleMessage(member, msg, send).catch((err) => {
        send({ t: 'error', code: 'internal', message: String(err) });
      });
    });

    const cleanup = (): void => {
      this.sockets.delete(socket);
      this.broadcastMemberCount();
    };
    socket.addEventListener('close', cleanup);
    socket.addEventListener('error', cleanup);
  }

  private async handleMessage(
    member: MemberSocket,
    msg: ClientMessage,
    send: (msg: ServerMessage) => void,
  ): Promise<void> {
    switch (msg.t) {
      case 'ping': {
        send({ t: 'pong', clientSendTime: msg.clientSendTime, serverTime: Date.now() });
        return;
      }
      case 'claim-owner': {
        if (this.ownerSecret !== null && msg.secret === this.ownerSecret) {
          member.isOwner = true;
          send({
            t: 'welcome',
            sessionId: this.sessionId ?? '',
            memberId: member.memberId,
            serverTime: Date.now(),
            isOwner: true,
          });
        } else {
          send({ t: 'error', code: 'bad-secret', message: 'Owner secret rejected' });
        }
        return;
      }
      case 'set-state': {
        if (!member.isOwner) {
          send({ t: 'error', code: 'not-owner', message: 'Only the owner may change state' });
          return;
        }
        const next: SessionState = {
          sessionId: this.sessionId ?? '',
          ...msg.state,
          version: (this.sessionState?.version ?? 0) + 1,
        };
        this.sessionState = next;
        await this.state.storage.put('state', next);
        this.broadcastState();
        return;
      }
      case 'play':
      case 'pause':
      case 'stop':
      case 'next-song':
      case 'prev-song': {
        // Placeholder transitions. Full setlist semantics land with Concert Mode work.
        if (!member.isOwner) {
          send({ t: 'error', code: 'not-owner', message: 'Only the owner may control playback' });
          return;
        }
        if (!this.sessionState) return;
        if (msg.t === 'play' && msg.songId) {
          this.sessionState = {
            ...this.sessionState,
            playback: { kind: 'playing', songId: msg.songId, anchorServerTime: Date.now() },
            version: this.sessionState.version + 1,
          };
        } else if (msg.t === 'pause') {
          this.sessionState = {
            ...this.sessionState,
            playback: { kind: 'paused', songId: 'default', pausedAtBeat: 0 },
            version: this.sessionState.version + 1,
          };
        } else if (msg.t === 'stop') {
          this.sessionState = {
            ...this.sessionState,
            playback: { kind: 'stopped' },
            version: this.sessionState.version + 1,
          };
        }
        await this.state.storage.put('state', this.sessionState);
        this.broadcastState();
        return;
      }
      case 'hello':
        return; // ack-only; handled at connect time
      default: {
        const exhaustiveCheck: never = msg;
        send({ t: 'error', code: 'unknown', message: `Unknown message: ${JSON.stringify(exhaustiveCheck)}` });
      }
    }
  }

  private broadcast(msg: ServerMessage): void {
    const payload = JSON.stringify(msg);
    for (const m of this.sockets.values()) {
      try {
        m.socket.send(payload);
      } catch {
        // ignore — close handler will clean up
      }
    }
  }

  private broadcastState(): void {
    if (this.sessionState) this.broadcast({ t: 'state', state: this.sessionState });
  }

  private broadcastMemberCount(): void {
    this.broadcast({ t: 'member-count', count: this.sockets.size });
  }
}
