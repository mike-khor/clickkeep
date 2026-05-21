import { describe, expect, it } from 'vitest';
import { bestEstimate, clientToServer, offsetFromSample, serverToClient } from './clock.js';

describe('clock offset', () => {
  it('computes zero offset for a perfectly-synced symmetric round trip', () => {
    // Client sends at t=1000, server receives at t=1050 (50ms latency),
    // client receives at t=1100. Symmetric round trip → offset 0.
    const est = offsetFromSample({ clientSendTime: 1000, serverTime: 1050, clientRecvTime: 1100 });
    expect(est.offsetMs).toBe(0);
    expect(est.rttMs).toBe(100);
  });

  it('detects a positive offset when the server clock leads', () => {
    // Server clock is 500ms ahead. Round trip 100ms symmetric.
    const est = offsetFromSample({ clientSendTime: 1000, serverTime: 1550, clientRecvTime: 1100 });
    expect(est.offsetMs).toBe(500);
  });

  it('picks the lowest-RTT sample from a batch', () => {
    const samples = [
      { clientSendTime: 0, serverTime: 200, clientRecvTime: 400 }, // rtt 400
      { clientSendTime: 0, serverTime: 50, clientRecvTime: 100 }, // rtt 100
      { clientSendTime: 0, serverTime: 100, clientRecvTime: 200 }, // rtt 200
    ];
    const est = bestEstimate(samples)!;
    expect(est.rttMs).toBe(100);
  });

  it('returns null for empty sample array', () => {
    expect(bestEstimate([])).toBeNull();
  });

  it('translates between server and client time', () => {
    const est = { offsetMs: 500, rttMs: 50 };
    expect(serverToClient(2000, est)).toBe(1500);
    expect(clientToServer(1500, est)).toBe(2000);
  });
});
