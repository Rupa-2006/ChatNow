# ChatNow — Socket.IO Event Contract

Path: `/socket.io`. One namespace (`/`). Event names are `domain:action`.

## Connection and authentication

```ts
const socket = io(ORIGIN, {
  auth: { token: accessToken },     // the same short-lived JWT used for REST
  transports: ["websocket"],        // see "Why WebSocket-only" below
});
```

Server-side handshake middleware, in order:

1. Verify the JWT signature and expiry. Failure → `connect_error` with
   `{ message: "UNAUTHENTICATED" }`; the socket is never created.
2. Load the user; reject if the account no longer exists.
3. Attach `socket.data.userId`. **Every handler reads the user id from here and never
   from a payload.**
4. Join `user:{userId}` and one `conversation:{id}` room per active membership.
5. Register the socket in Redis presence; if it is the user's first live socket,
   broadcast `presence:update`.
6. Mark every still-undelivered receipt for this user as delivered and notify the senders.

**Token expiry on a live socket.** The server schedules a disconnect at the token's
`exp`. Before that, the client refreshes over REST and sends `auth:refresh` with the new
token; the server re-verifies it and reschedules. A session revoked by
logout-all/password change is disconnected immediately through a Redis-published
`disconnectSockets` on `user:{id}`.

**Why WebSocket-only.** Socket.IO's default starts with HTTP long-polling, where each
poll is a separate HTTP request. Behind a load balancer those requests can land on
different instances, which breaks the session unless sticky sessions are configured.
Forcing the `websocket` transport means one connection stays on one instance, so the
load balancer can be plain round-robin. Every browser ChatNow targets supports it.

**Rooms are server-assigned only.** There is no `join` event. Membership changes
(added to / removed from a group) make the server call `socketsJoin` / `socketsLeave`
on `user:{id}`, which the Redis adapter applies on whichever instance holds those sockets.

## Acknowledgements

Client → server events that change state take an ack callback:

```ts
type Ack<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };
```

Error codes match the REST contract (`VALIDATION_ERROR`, `NOT_FOUND`, `FORBIDDEN`,
`RATE_LIMITED`, `INTERNAL_ERROR`).

## Client → server

| Event | Payload | Ack data | Authorization |
|---|---|---|---|
| `message:send` | `{ conversationId, content, clientId, replyToId?, attachmentIds? }` | `Message` | Active member; for DIRECT, no block in either direction |
| `message:edit` | `{ messageId, content }` | `Message` | Sender, within 15 minutes |
| `message:delete` | `{ messageId }` | — | Sender, or OWNER/ADMIN |
| `message:react` | `{ messageId, emoji, remove? }` | `Message` | Active member |
| `message:delivered` | `{ messageIds: string[] }` (≤ 100) | — | Only receipts belonging to the caller are touched |
| `conversation:read` | `{ conversationId, messageId }` | — | Active member |
| `typing:start` | `{ conversationId }` | none | Active member |
| `typing:stop` | `{ conversationId }` | none | Active member |
| `presence:subscribe` | `{ userIds: string[] }` (≤ 200) | `{ [userId]: { isOnline, lastSeenAt } }` | Returns `false/null` for users with a block in either direction |
| `auth:refresh` | `{ token }` | — | Token must be valid and for the same user |

Every payload is validated with the same Zod schemas as the REST endpoints, and
`message:*` handlers call the same service functions as the REST controllers.

## Server → client

| Event | Payload | Sent to |
|---|---|---|
| `message:new` | `Message` | `conversation:{id}` (including the sender's other tabs). For a reply, members who joined after the quoted message are excluded from the room broadcast and sent a copy with `replyTo.hidden: true` on `user:{id}`; the same applies to `message:updated` |
| `message:updated` | `Message` | `conversation:{id}` |
| `message:deleted` | `{ conversationId, messageId, deletedAt }` | `conversation:{id}` |
| `message:reaction` | `{ conversationId, messageId, reactions }` | `conversation:{id}` |
| `receipt:update` | `{ conversationId, messageIds, userId, status: "delivered" \| "read", at }` | `user:{senderId}` for each affected sender |
| `conversation:new` | `Conversation` | `user:{id}` of each member |
| `conversation:updated` | `{ id, type, name, avatarUrl, members }`: shared fields only; never the editor's role, unread count, mute state or preview | `conversation:{id}` |
| `conversation:removed` | `{ conversationId }` | `user:{id}` of a removed or leaving member |
| `member:added` / `member:removed` / `member:role` | `{ conversationId, member }` / `{ conversationId, userId }` / `{ conversationId, userId, role }` | `conversation:{id}` |
| `typing:update` | `{ conversationId, userId, isTyping }` | `conversation:{id}` except the typist |
| `presence:update` | `{ userId, isOnline, lastSeenAt }` | Users who share a conversation with that user |
| `notification:new` | `Notification` | `user:{id}` |
| `session:revoked` | `{ reason }` | `user:{id}`, immediately before disconnect |

## Message lifecycle and tick states

```
sending  ──ack──▶  sent ✓  ──recipient's client confirms──▶  delivered ✓✓  ──recipient opens chat──▶  read ✓✓ (accent)
   │
   └─ no ack within 10 s / disconnected ─▶ failed (retry reuses the same clientId)
```

- **sending**: optimistic bubble, keyed by `clientId`.
- **sent**: the server stored it and acked.
- **delivered**: the recipient's client emitted `message:delivered` (or connected later
  and the server flushed pending receipts in handshake step 6).
- **read**: the recipient emitted `conversation:read` while the conversation was open
  and the tab was focused.
- **Groups**: delivered when *every* other member has it; read when *every* other member
  has read it. The details panel can list per-member state.

## Typing

The client emits `typing:start` on the first keystroke, then at most once every 3 s
while typing continues, and `typing:stop` on send, on clearing the input, or after 5 s
idle. The server keeps no durable state: it relays, and receivers expire an indicator on
their own after 6 s without a refresh, so a lost `typing:stop` can never leave someone
"typing…" forever.

## Presence

Stored in Redis so that every instance sees the same answer:

- `presence:sockets:{userId}` — a set of that user's live socket ids, refreshed by a
  heartbeat and given a TTL, so entries from a crashed instance age out.
- On connect: add the socket id; if the set size went 0 → 1, broadcast online.
- On disconnect: remove it; if the set is now empty, wait a 5 s grace period (a page
  refresh should not flicker offline), re-check, then write `lastSeenAt` to PostgreSQL
  and broadcast offline.

A user with three tabs open stays online until the last one closes.

## Reconnection

Socket.IO reconnects automatically with exponential backoff. On every (re)connect the
client:

1. Obtains a fresh access token if the current one is expired.
2. Refetches the conversation list (unread counts and last messages).
3. For the open conversation, fetches messages newer than the newest one it holds.
4. Resends any `sending`/`failed` messages with their original `clientId`
   (the unique index on `(senderId, clientId)` makes this safe).
5. Re-subscribes to presence.

Events are therefore treated as *hints that speed things up*; PostgreSQL remains the
source of truth and a reconnect always converges to it.

## Abuse limits

A per-socket token bucket in Redis: 20 `message:send` per 10 s, 60 `typing:*` per
minute, 120 other events per minute. Exceeding it returns `RATE_LIMITED` in the ack;
sustained abuse disconnects the socket and writes an audit entry. Maximum packet size
is capped at 100 KB (`maxHttpBufferSize`), far above any valid payload.

## Logged events (to ELK)

`socket.connected`, `socket.disconnected` (with reason and duration),
`socket.auth_failed`, `message.sent`, `message.delivered`, `message.read`,
`socket.rate_limited`, `socket.forbidden`. Each carries `userId`, `conversationId`,
`messageId`, `instance` and `requestId` where relevant — **never** `content`, tokens or
cookies.
