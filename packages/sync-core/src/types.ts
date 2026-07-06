// AGENT_GUARDRAIL: this file defines the wire protocol shared by every client and the
// session Durable Object. Changes here ripple to all platforms — audio, watch, future
// native shells. Edits to this file are Tier 3 (see CLAUDE.md).

export type SessionId = string;
export type MemberId = string;

export interface TempoSegment {
  /** Server time (ms since epoch) at which this segment starts. */
  startAt: number;
  /** Beats per minute. */
  bpm: number;
  /** Beats per bar (time signature numerator). */
  beatsPerBar: number;
}

/**
 * Per-beat accent map for a bar. Length matches the current bar's
 * `beatsPerBar`; index 0 is the downbeat. Optional on the wire for
 * back-compat with older clients — absent means "default to accent on
 * downbeat, normal elsewhere".
 */
export type BeatState = 'accent' | 'normal' | 'mute';

export interface SongState {
  id: string;
  title: string;
  /** Ordered tempo segments. The first segment's `startAt` is the song's downbeat zero. */
  tempo: TempoSegment[];
  /** Optional per-beat accent pattern; omit to fall back to accent-on-downbeat. */
  accentPattern?: BeatState[];
}

export interface SessionState {
  sessionId: SessionId;
  /** Display name of the owner ("Mike's rehearsal"). Optional. */
  label?: string;
  /** Current playback state. */
  playback:
    | { kind: 'stopped' }
    | { kind: 'playing'; songId: string; anchorServerTime: number }
    | { kind: 'paused'; songId: string; pausedAtBeat: number };
  /** Loaded setlist (in order). May be a single song. */
  setlist: SongState[];
  /** Monotonically increasing version number; bumps on every state change. */
  version: number;
}

// ----- Wire messages: client → server -----

export type ClientMessage =
  | { t: 'hello'; memberId: MemberId; clientSendTime: number }
  | { t: 'ping'; clientSendTime: number }
  | { t: 'claim-owner'; secret: string }
  | { t: 'set-state'; state: Omit<SessionState, 'sessionId' | 'version'> }
  | { t: 'play'; songId: string }
  | { t: 'pause' }
  | { t: 'stop' }
  | { t: 'next-song' }
  | { t: 'prev-song' };

// ----- Wire messages: server → client -----

export type ServerMessage =
  | { t: 'welcome'; sessionId: SessionId; memberId: MemberId; serverTime: number; isOwner: boolean }
  | { t: 'pong'; clientSendTime: number; serverTime: number }
  | { t: 'state'; state: SessionState }
  | { t: 'member-count'; count: number }
  | { t: 'error'; code: string; message: string };
