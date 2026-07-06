import {
  bestEstimate,
  type ClientMessage,
  type ClockEstimate,
  type ClockSample,
  type ServerMessage,
  type SessionState,
} from '@clickkeep/sync-core';

export interface SessionClientEvents {
  onState: (s: SessionState) => void;
  onMemberCount: (n: number) => void;
  onClockEstimate: (e: ClockEstimate) => void;
  onError: (code: string, msg: string) => void;
  onClose: () => void;
}

const PING_SAMPLES_AT_CONNECT = 6;
const PING_INTERVAL_MS = 30_000;

export class SessionClient {
  private socket: WebSocket;
  private samples: ClockSample[] = [];
  private estimate: ClockEstimate | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pingsRemaining = PING_SAMPLES_AT_CONNECT;
  private isOwner = false;
  private ownerSecret: string | null;
  private events: SessionClientEvents;
  // Set true when the caller explicitly closes (leave / effect teardown /
  // StrictMode remount). The browser's WS close event fires asynchronously, so
  // without this flag a client we've already replaced would still fire onClose
  // → setSessionRole('solo'), clobbering the new client's role.
  private closedByCaller = false;

  constructor(url: string, ownerSecret: string | null, events: SessionClientEvents) {
    this.events = events;
    this.ownerSecret = ownerSecret;
    this.socket = new WebSocket(url);
    this.socket.addEventListener('open', () => this.onOpen());
    this.socket.addEventListener('message', (e) => this.onMessage(e));
    this.socket.addEventListener('close', () => this.onClose());
    this.socket.addEventListener('error', () => {
      if (this.closedByCaller) return;
      this.events.onError('socket', 'WebSocket error');
    });
  }

  private onOpen(): void {
    if (this.ownerSecret) {
      this.send({ t: 'claim-owner', secret: this.ownerSecret });
    }
    // Burst initial pings to get a good clock-offset estimate fast.
    for (let i = 0; i < PING_SAMPLES_AT_CONNECT; i++) {
      setTimeout(() => this.ping(), i * 50);
    }
    this.pingTimer = setInterval(() => this.ping(), PING_INTERVAL_MS);
  }

  private onClose(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    if (this.closedByCaller) return;
    this.events.onClose();
  }

  private ping(): void {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    this.send({ t: 'ping', clientSendTime: Date.now() });
  }

  private onMessage(event: MessageEvent<string>): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    switch (msg.t) {
      case 'welcome':
        this.isOwner = msg.isOwner;
        break;
      case 'pong': {
        const sample: ClockSample = {
          clientSendTime: msg.clientSendTime,
          serverTime: msg.serverTime,
          clientRecvTime: Date.now(),
        };
        this.samples.push(sample);
        // Keep a rolling window of the last 12 samples.
        if (this.samples.length > 12) this.samples = this.samples.slice(-12);
        const next = bestEstimate(this.samples);
        if (next !== null) {
          this.estimate = next;
          this.events.onClockEstimate(next);
        }
        this.pingsRemaining = Math.max(0, this.pingsRemaining - 1);
        break;
      }
      case 'state':
        this.events.onState(msg.state);
        break;
      case 'member-count':
        this.events.onMemberCount(msg.count);
        break;
      case 'error':
        this.events.onError(msg.code, msg.message);
        break;
    }
  }

  send(msg: ClientMessage): void {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(msg));
  }

  close(): void {
    this.closedByCaller = true;
    this.socket.close();
  }

  getEstimate(): ClockEstimate | null {
    return this.estimate;
  }

  getIsOwner(): boolean {
    return this.isOwner;
  }

  /** Translate a server time (ms since epoch) into a local time the AudioContext can act on. */
  nowServerMs(): number {
    if (this.estimate === null) return Date.now();
    return Date.now() + this.estimate.offsetMs;
  }
}
