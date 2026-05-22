# ClickKeep session protocol

> Audience: future-me and any agent landing here cold. Read this before
> proposing a wire-format change. Then propose anyway if you disagree — but
> at least disagree with the actual trade-offs.

## Current design

ClickKeep speaks **JSON-stringified `ClientMessage` / `ServerMessage` over a
single WebSocket** per session member. The Cloudflare Durable Object
(`workers/session/src/session-do.ts`) is the only server. There is one DO
per session, and every joined member opens one WebSocket to it.

The wire types are defined in
[`packages/sync-core/src/types.ts`](../packages/sync-core/src/types.ts) and
shared verbatim by the web client and (eventually) the native shells. Every
message is a JSON object with a discriminant field `t`.

### Example 1 — clock-offset ping/pong

Client sends:

```json
{ "t": "ping", "clientSendTime": 1715000000123 }
```

Server replies:

```json
{ "t": "pong", "clientSendTime": 1715000000123, "serverTime": 1715000000131 }
```

The client takes a handful of these on connect (6 in a burst, ~50 ms
apart), then one every 30 s, and feeds them into the NTP-style estimator
in `packages/sync-core/src/clock.ts`. **This is the only periodic traffic
the protocol carries.** Beats are scheduled locally by each client from
the shared anchor; the server never sends a "tick".

### Example 2 — owner changes state

Owner sends:

```json
{
  "t": "set-state",
  "state": {
    "playback": { "kind": "playing", "songId": "default", "anchorServerTime": 1715000005000 },
    "setlist": [
      { "id": "default", "title": "Untitled",
        "tempo": [{ "startAt": 0, "bpm": 132, "beatsPerBar": 4 }] }
    ]
  }
}
```

Server bumps `version`, persists to DO storage, fans out to every
connected member:

```json
{
  "t": "state",
  "state": {
    "sessionId": "ABCD",
    "playback": { "kind": "playing", "songId": "default", "anchorServerTime": 1715000005000 },
    "setlist": [ /* ... */ ],
    "version": 7
  }
}
```

Members compute beat times locally from `anchorServerTime + tempo` and
schedule them on their own audio clock. Drift is bounded by the 30 s
ping/pong refresh.

### Traffic profile

For a typical session of N members:

- **Per member, steady state:** 1 ping + 1 pong ≈ 30 s. Maybe a
  `member-count` broadcast on join/leave. Hundreds of bytes/second per
  member, *not* kilobytes.
- **Per state change:** one `set-state` from the owner, one `state`
  broadcast to all N members. A full state for a 10-song setlist with
  rich tempo maps fits comfortably under 4 KB.
- **Per beat:** **zero bytes.** This is the invariant in
  [`CLAUDE.md`](../CLAUDE.md): "the server never sends tick messages."

That traffic profile is what makes the rest of this document possible.

## Why JSON, not binary

Four reasons, ranked by how much we'd cling to them:

1. **Debuggability.** Open the browser devtools, watch the WebSocket
   frames, read English. Reproduce a bug by pasting a frame into a unit
   test. Diff two `state` messages by eye. Binary formats turn every
   diagnosis into a "load a decoder" detour.
2. **Type-sharing with TypeScript.** `ClientMessage` / `ServerMessage` are
   `import`-ed by the web client and the Worker from the same package.
   `JSON.parse(...) as ClientMessage` plus a discriminated union is good
   enough; the compiler enforces exhaustiveness on the server's `switch`
   (see the `never` exhaustive check in `handleMessage`).
3. **Universal parser.** Browser, Node, Cloudflare Workers, future
   React Native shell, future Capacitor build, future SwiftUI watch app
   — every one of them parses JSON for free. No binary lib to vendor on
   five platforms.
4. **Messages are small anyway.** The whole point of this protocol is
   that *most of the time it carries nothing*. The remaining traffic
   does not stress any network or any CPU.

We are explicitly **not** in the regime where binary wins. Binary wins
when you're sending megabytes per second, or when CPU spent on
serialization is measurable against the rest of the work. Neither holds.

## Alternatives evaluated

### MessagePack

A binary "smaller JSON". Same shape (untyped maps + arrays), more
compact on the wire (≈30 % reduction for typical payloads), and
roughly the same developer ergonomics once a decoder is loaded.
The tradeoff is one extra dependency on every platform, one extra
layer of friction when debugging in devtools, and no schema
guarantees beyond what JSON gives us. Worth it at our scale?
Almost certainly not — a 30 % cut of "hundreds of bytes per second"
is still nothing, and the diagnostic cost is real.

### Protocol Buffers / Cap'n Proto

Strongly schematized, compact, and fast — these are the right answers
for high-throughput backbone services. They are the wrong answer for
ClickKeep. Adopting them means a code-generation step in every
language we target (TS, eventually Swift, eventually Kotlin), a
`.proto` file as a parallel source of truth alongside `types.ts`, and
a steeper barrier for a contributor showing up cold. "Approachable" is
a project value (see CLAUDE.md tier rules and the Jackbox-style
join-code UX); a codegen toolchain is the opposite of approachable.

### CBOR

"Standardized MessagePack." The IETF blessing is nice, but the
practical situation is identical: marginal payload reduction, still
schema-less, still a dependency to vendor on every platform. The fact
that it's RFC-ratified does not change the cost-benefit at our message
sizes. Pass.

### Raw binary frames

A hand-rolled binary frame format would only pay for itself if we were
streaming dense per-beat data — e.g. if the server pushed an individual
"tick now" message every 20–60 ms. We deliberately don't do that:
clients schedule beats locally from the shared anchor (see CLAUDE.md
invariant #1). Without per-beat traffic, there is no payload to
compress. Raw binary is the right answer to a problem we don't have.

### Server-Sent Events + POST

A common "simpler than WebSocket" pattern: members subscribe via SSE
for server→client updates, and owners send commands via plain HTTP
POST. The infra footprint is genuinely smaller — no upgrade handshake,
no socket lifecycle. But: (a) we already have cheap, bidirectional
WebSocket out of the box via the Durable Object, so we are not paying
for the WebSocket we have; (b) client→server messages (`ping`,
`claim-owner`, `set-state`) being a separate HTTP path means two
transports to reason about for one logical session; (c) clock-offset
ping/pong over POST adds non-trivial latency variance vs. an open
socket. Worse fit, not simpler in practice.

### WebTransport / WebSocket over HTTP/3

Future-looking. Cleaner congestion control, multiplexing without
head-of-line blocking, potentially lower latency. Browser and CDN
support are still uneven in mid-2026, and Cloudflare's edge support
for WebTransport at DO scale is not the boring path. Revisit in a
couple of years, or sooner if we genuinely need sub-50 ms message
delivery — which, again, our protocol is designed not to need.

## When we'd reconsider

These are the **concrete trigger conditions** that would force this
decision back open. Until one of them fires, JSON-over-WebSocket is
the right answer.

- **Median outbound message size exceeds ~4 KB.** A `state` payload
  with 50 songs and per-beat tempo annotations could approach this.
  Compress (`permessage-deflate`) first; pick a binary format only if
  compression doesn't close the gap. Note that DOs already support
  WebSocket permessage-deflate; we don't currently opt in because we
  don't need it.
- **We start streaming audio or any continuous signal.** We won't —
  this is explicitly out of scope (see CLAUDE.md: "Free forever",
  free + Cloudflare-DO + audio streaming is not a stable combination
  at scale). But if it ever changed, audio goes over a separate
  transport (WebRTC / WebTransport), *not* this protocol.
- **Cloudflare egress bills become non-trivial.** Large fan-outs to
  many members in a single session (think a 200-person worship-band
  rehearsal) would multiply every state broadcast. If bills hit a
  level worth optimizing, payload size starts mattering and binary
  becomes worth evaluating.
- **Sustained message rate per member exceeds ~10/s.** This would
  most likely mean we'd violated invariant #1 and started pushing
  per-beat traffic. The correct response is "stop doing that," not
  "switch to a binary format."

## Backwards compatibility plan

The message envelope already has a `t` discriminator on every frame
(`hello`, `ping`, `state`, `welcome`, `pong`, etc.). Adding a new
message variant — say `{ t: 'tempo-only', bpm: 132 }` — is therefore
**additive** by construction: old peers that don't know the new `t`
value can ignore it, and TypeScript's discriminated union flags any
exhaustive `switch` we forgot to update.

**Current behavior — verified against the code:**

- **Client side** (`apps/web/src/lib/session-client.ts`,
  `SessionClient.onMessage`): the `switch (msg.t)` has *no* `default`
  branch. Unknown server message types are silently dropped, which is
  exactly what we want for forward compatibility — a server that
  starts sending a new `t` will not crash older clients.
- **Server side** (`workers/session/src/session-do.ts`,
  `SessionDO.handleMessage`): the `switch (msg.t)` has a `default`
  that performs an exhaustive `never` check and sends back an
  `{ t: 'error', code: 'unknown', ... }`. This is the right call for
  a *server-as-source-of-truth* design: a client sending an unknown
  command is more likely a bug than a forward-compat scenario, and an
  explicit error helps surface that bug instead of silently dropping
  the command. A future client speaking a newer dialect should
  feature-detect (e.g. via `welcome.serverTime` + a future
  `protocolVersion` field) before sending novel command types.

**Rules of thumb when adding a message type:**

1. Add the new variant to the discriminated union in
   `packages/sync-core/src/types.ts`.
2. If it's a server→client message, the client `switch` will keep
   compiling (no `default`, no exhaustiveness requirement) and old
   builds will silently ignore it. New clients add a `case`.
3. If it's a client→server message, the server `switch` *will* fail
   to compile (exhaustive `never` check) until you handle it. That's
   the safety net: you cannot ship a new command and forget to handle
   it on the server.
4. Never rename an existing `t` value. Never repurpose one. Add a new
   `t`, deprecate the old in code comments, ship the cutover behind a
   `protocolVersion` once we introduce one. (We don't yet, because we
   haven't needed to break anything. The first breaking change is the
   right moment to add it.)

## Recommendation

**Nothing to change today.** JSON-over-WebSocket is the right choice
for ClickKeep's current and foreseeable traffic profile. The doc
above exists so that future-me (or a future agent) doesn't burn a
weekend "optimizing" a wire format that isn't a bottleneck.

If a single, low-effort follow-up is worth queuing for Mike to add to
`BACKLOG.md` (Tier 3 file, not editable from this doc-only PR):

> **[tier:3] [size:S] Add `protocolVersion` field to `welcome` server
> message** — a single integer (`1` today) sent by the server on
> connect. Costs nothing, makes the *first* breaking change someday
> a one-line check instead of a discovery exercise. Lives in
> `packages/sync-core/src/types.ts` + a one-line set in
> `workers/session/src/session-do.ts`.

Until then: leave it alone.
