// AGENT_GUARDRAIL: this is the public API surface of the session worker. Tier 3.
// Routes:
//   POST   /sessions           → create a session, return { code, ownerSecret }
//   GET    /sessions/:code/ws  → WebSocket upgrade for join

import type { SessionId } from '@clickkeep/sync-core';

export { SessionDO } from './session-do.js';

interface Env {
  SESSION: DurableObjectNamespace;
  JOIN_CODES: KVNamespace;
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no O/0/I/1/L — visually unambiguous
const CODE_LENGTH = 4;
const CODE_TTL_SECONDS = 60 * 60 * 24; // 24h; renew on activity

function generateCode(): string {
  let out = '';
  const buf = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(buf);
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[buf[i]! % CODE_ALPHABET.length];
  }
  return out;
}

function corsHeaders(origin: string | null): Record<string, string> {
  // For now we allow any origin in dev. Lock down before public launch (Tier 3 change).
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin');

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    // Create session.
    if (req.method === 'POST' && url.pathname === '/sessions') {
      const sessionId = crypto.randomUUID() as SessionId;
      const ownerSecret = crypto.randomUUID();
      // Try a few codes in case of collision. With 31^4 = ~924k codes and low concurrency,
      // collisions are rare; we still guard.
      let code = '';
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = generateCode();
        const existing = await env.JOIN_CODES.get(candidate);
        if (existing === null) {
          code = candidate;
          break;
        }
      }
      if (!code) {
        return new Response('Could not allocate a join code; please retry.', { status: 503 });
      }
      await env.JOIN_CODES.put(code, sessionId, { expirationTtl: CODE_TTL_SECONDS });
      // Initialize the DO with the owner secret so it can authorize claim-owner.
      const stub = env.SESSION.get(env.SESSION.idFromName(sessionId));
      await stub.fetch('https://session/init', {
        method: 'POST',
        body: JSON.stringify({ sessionId, ownerSecret }),
      });
      return new Response(JSON.stringify({ code, sessionId, ownerSecret }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    // Join (WebSocket upgrade).
    const wsMatch = url.pathname.match(/^\/sessions\/([A-Z0-9]+)\/ws$/);
    if (wsMatch) {
      const code = wsMatch[1]!;
      const sessionId = await env.JOIN_CODES.get(code);
      if (sessionId === null) {
        return new Response('Session not found or expired', { status: 404, headers: corsHeaders(origin) });
      }
      // Renew TTL on activity.
      await env.JOIN_CODES.put(code, sessionId, { expirationTtl: CODE_TTL_SECONDS });
      const stub = env.SESSION.get(env.SESSION.idFromName(sessionId));
      return stub.fetch(req);
    }

    return new Response('Not found', { status: 404, headers: corsHeaders(origin) });
  },
};
