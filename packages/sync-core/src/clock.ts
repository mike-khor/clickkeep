// AGENT_GUARDRAIL: clock offset is the single most important sync primitive.
// Bugs here desynchronize every connected device. Edits are Tier 3.

/**
 * One round-trip sample of (clientSend, serverRecv, clientRecv).
 * We don't observe serverSend separately; we assume server processing is instant,
 * which is fine at WebSocket latencies of <100ms.
 */
export interface ClockSample {
  /** When the client sent the ping (client clock, ms). */
  clientSendTime: number;
  /** When the server logged receipt (server clock, ms). */
  serverTime: number;
  /** When the client received the pong (client clock, ms). */
  clientRecvTime: number;
}

export interface ClockEstimate {
  /** Add this to client time to get server time. */
  offsetMs: number;
  /** Half of round-trip — confidence indicator. */
  rttMs: number;
}

/**
 * NTP-style offset from a single sample.
 *
 * Derivation: assume server processes the ping at time T_s. Round-trip is
 * symmetric on average, so T_s = clientSend + RTT/2 + offset. Rearranging:
 *   offset = serverTime - clientSend - RTT/2
 * which simplifies to (serverTime - (clientSend + clientRecv)/2).
 */
export function offsetFromSample(s: ClockSample): ClockEstimate {
  const rtt = s.clientRecvTime - s.clientSendTime;
  const offset = s.serverTime - (s.clientSendTime + s.clientRecvTime) / 2;
  return { offsetMs: offset, rttMs: rtt };
}

/**
 * Aggregate several samples into a single estimate. We pick the sample with the
 * smallest RTT (least jitter), which is the standard NTP heuristic. Mean would
 * be biased upward by tail latency.
 */
export function bestEstimate(samples: ClockSample[]): ClockEstimate | null {
  if (samples.length === 0) return null;
  let best = offsetFromSample(samples[0]!);
  for (let i = 1; i < samples.length; i++) {
    const candidate = offsetFromSample(samples[i]!);
    if (candidate.rttMs < best.rttMs) best = candidate;
  }
  return best;
}

/** Translate a server time to local client time using the estimate. */
export function serverToClient(serverTimeMs: number, estimate: ClockEstimate): number {
  return serverTimeMs - estimate.offsetMs;
}

/** Translate a local client time to server time. */
export function clientToServer(clientTimeMs: number, estimate: ClockEstimate): number {
  return clientTimeMs + estimate.offsetMs;
}
