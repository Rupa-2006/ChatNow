# ChatNow — REST API Contract

Base path: `/api`. JSON in, JSON out (`Content-Type: application/json`), except file
upload (`multipart/form-data`) and file download (binary).

## Conventions

**Authentication.** Every endpoint except those marked *public* requires
`Authorization: Bearer <accessToken>`. The refresh token travels only as the
`chatnow_rt` cookie (`HttpOnly; Secure; SameSite=Strict; Path=/api/auth`) and is never
readable by JavaScript or present in a response body.

**Success envelope.**

```json
{ "data": { }, "meta": { "nextCursor": "..." } }
```

`meta` is present only on paginated lists.

**Error envelope.** Every non-2xx response has this shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "path": "password", "message": "Must be at least 10 characters" }],
    "requestId": "b1f0c6e2-..."
  }
}
```

| HTTP | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body, query or params failed the Zod schema |
| 401 | `UNAUTHENTICATED` | Missing, malformed or expired access token |
| 401 | `INVALID_CREDENTIALS` | Wrong email/username or password (deliberately the same message for both) |
| 401 | `REFRESH_INVALID` | Refresh cookie missing, expired, revoked or reused |
| 403 | `FORBIDDEN` | Authenticated but not allowed (wrong role, blocked) |
| 404 | `NOT_FOUND` | Resource does not exist **or the caller is not a member of it** |
| 409 | `CONFLICT` | Email or username already taken; duplicate member |
| 413 | `PAYLOAD_TOO_LARGE` | Upload exceeds the size limit |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | File type not on the allow-list |
| 429 | `RATE_LIMITED` | Rate limit exceeded; `Retry-After` header is set |
| 500 | `INTERNAL_ERROR` | Unexpected failure; details are logged, never returned |

Returning **404 rather than 403** for a conversation the caller is not in is intentional:
a 403 would confirm that the id exists.

**Pagination.** Lists take `?limit=` (default 30, max 100) and `?cursor=` (opaque string
from the previous `meta.nextCursor`). `nextCursor: null` means the end.

**Rate limits** (per IP for public routes, per user otherwise; counters live in Redis):

| Scope | Limit |
|---|---|
| `POST /auth/login`, `POST /auth/register` | 10 per 15 min per IP |
| `POST /auth/refresh` | 60 per 15 min per IP |
| Search endpoints | 60 per minute |
| Uploads | 20 per 10 min |
| Everything else | 300 per minute |

## Shared object shapes

```ts
type PublicUser = {
  id: string; username: string; displayName: string;
  avatarUrl: string | null; bio: string | null;
  isOnline: boolean; lastSeenAt: string | null;   // both hidden (false / null) if blocked
};

type Me = PublicUser & {
  email: string; createdAt: string;
  notificationPrefs: { browser: boolean; sound: boolean; messagePreview: boolean };
};

type Member = { user: PublicUser; role: "OWNER" | "ADMIN" | "MEMBER"; joinedAt: string };

type Conversation = {
  id: string; type: "DIRECT" | "GROUP";
  name: string | null; avatarUrl: string | null;   // for DIRECT, the client shows the other member
  members: Member[];
  lastMessage: Message | null;
  unreadCount: number;
  mutedUntil: string | null;
  myRole: "OWNER" | "ADMIN" | "MEMBER";
  createdAt: string; lastMessageAt: string | null;
};

type Message = {
  id: string; conversationId: string; senderId: string;
  type: "TEXT" | "FILE" | "SYSTEM";
  content: string;                 // "" when deleted
  clientId: string;
  replyTo: { id: string; senderId: string; content: string; deleted: boolean } | null;
  attachments: Attachment[];
  reactions: { emoji: string; userIds: string[] }[];
  status: "sent" | "delivered" | "read";   // meaningful to the sender only
  editedAt: string | null; deletedAt: string | null; createdAt: string;
};

type Attachment = {
  id: string; originalName: string; mimeType: string; sizeBytes: number;
  width: number | null; height: number | null;
  url: string;                     // /api/attachments/:id/download
};

type Notification = {
  id: string; type: string; conversationId: string | null; messageId: string | null;
  data: Record<string, unknown>; readAt: string | null; createdAt: string;
};
```

## Health

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/health` | public | `200 { status: "ok", instance, uptime, checks: { database, redis } }` or `503` if a dependency is down |

## Authentication

| Method | Path | Auth | Body | Success |
|---|---|---|---|---|
| POST | `/auth/register` | public | `{ email, username, displayName, password }` | `201 { data: { user: Me, accessToken } }` + sets refresh cookie |
| POST | `/auth/login` | public | `{ identifier, password }` — `identifier` is email or username | `200 { data: { user: Me, accessToken } }` + sets refresh cookie |
| POST | `/auth/refresh` | cookie | none | `200 { data: { accessToken } }` + **rotated** refresh cookie |
| POST | `/auth/logout` | cookie | none | `204`; revokes the session, clears the cookie |
| POST | `/auth/logout-all` | bearer | none | `204`; revokes every session of the user and disconnects their sockets |
| GET | `/auth/me` | bearer | — | `200 { data: Me }` |
| GET | `/auth/sessions` | bearer | — | `200 { data: [{ id, userAgent, ipAddress, createdAt, current }] }` |
| DELETE | `/auth/sessions/:id` | bearer | — | `204` |
| POST | `/auth/change-password` | bearer | `{ currentPassword, newPassword }` | `204`; revokes all other sessions |

Validation: `email` valid and ≤ 254 chars; `username` 3–24 chars, `[a-z0-9_]`;
`displayName` 1–50 chars; `password` 10–128 chars (length over composition rules, per
NIST SP 800-63B).

## Users

| Method | Path | Query / Body | Success |
|---|---|---|---|
| GET | `/users` | `?limit&cursor` | `200 { data: PublicUser[], meta }` — directory, excludes self and users who blocked the caller |
| GET | `/users/search` | `?q=` (2–50 chars) `&limit` | `200 { data: PublicUser[] }` |
| GET | `/users/:id` | — | `200 { data: PublicUser }` |
| PATCH | `/users/profile` | `{ displayName?, username?, bio?, notificationPrefs? }` | `200 { data: Me }` |
| POST | `/users/avatar` | multipart field `file` (JPEG/PNG/WebP, ≤ 2 MB) | `200 { data: Me }` |
| GET | `/users/blocks` | — | `200 { data: PublicUser[] }` |
| POST | `/users/:id/block` | — | `204` |
| DELETE | `/users/:id/block` | — | `204` |

## Conversations

| Method | Path | Body | Who | Success |
|---|---|---|---|---|
| GET | `/conversations` | `?q=` optional filter | member | `200 { data: Conversation[] }` sorted by `lastMessageAt` desc |
| POST | `/conversations` | `{ type: "DIRECT", userId }` or `{ type: "GROUP", name, memberIds[] }` | any user | `201 { data: Conversation }`; for DIRECT returns the existing one with `200` if it already exists |
| GET | `/conversations/:id` | — | member | `200 { data: Conversation }` |
| PATCH | `/conversations/:id` | `{ name?, mutedUntil? }` | `name`: OWNER/ADMIN; `mutedUntil`: any member (affects only the caller) | `200 { data: Conversation }` |
| POST | `/conversations/:id/avatar` | multipart `file` | OWNER/ADMIN | `200 { data: Conversation }` |
| POST | `/conversations/:id/members` | `{ userIds[] }` | OWNER/ADMIN, GROUP only | `200 { data: Conversation }` |
| DELETE | `/conversations/:id/members/:userId` | — | OWNER/ADMIN (an ADMIN cannot remove an ADMIN or the OWNER) | `204` |
| PATCH | `/conversations/:id/members/:userId` | `{ role: "ADMIN" \| "MEMBER" }` | OWNER | `200 { data: Member }` |
| POST | `/conversations/:id/leave` | — | member, GROUP only; if the OWNER leaves, ownership passes to the longest-standing ADMIN, else the longest-standing member | `204` |
| POST | `/conversations/:id/read` | `{ messageId }` | member | `204`; marks everything up to that message read |
| GET | `/conversations/:id/attachments` | `?limit&cursor` | member | `200 { data: Attachment[], meta }` — shared-media panel |

### Group permission matrix

| Action | OWNER | ADMIN | MEMBER |
|---|:-:|:-:|:-:|
| Send, react, reply | ✓ | ✓ | ✓ |
| Edit / delete own message | ✓ | ✓ | ✓ |
| Delete someone else's message | ✓ | ✓ | — |
| Rename group, change image | ✓ | ✓ | — |
| Add members | ✓ | ✓ | — |
| Remove a MEMBER | ✓ | ✓ | — |
| Remove an ADMIN | ✓ | — | — |
| Promote / demote | ✓ | — | — |
| Leave | ✓ | ✓ | ✓ |

## Messages

**History visibility.** A member sees only messages sent during their current
membership. Someone added to a group, or removed and added back, cannot read anything
said before they (re)joined. This holds on every route: history (including `?around=`),
both searches, reactions, mark-as-read and replies (all `404`/`400` for earlier
messages), attachment download and shared media, and the conversation list's
`lastMessage`, `lastMessageAt` and `unreadCount`. When a later message replies to an
earlier one, viewers who joined afterwards receive `replyTo: { content: "", hidden: true }`
instead of the quote.

| Method | Path | Query / Body | Who | Success |
|---|---|---|---|---|
| GET | `/conversations/:id/messages` | `?limit&cursor` (newest first), or `?around=<messageId>` to jump to a search hit | member | `200 { data: Message[], meta }` |
| POST | `/conversations/:id/messages` | `{ content, clientId, replyToId?, attachmentIds? }` | member, not blocked | `201 { data: Message }`; a repeated `clientId` returns the original with `200` |
| GET | `/conversations/:id/messages/search` | `?q=&limit&cursor` | member | `200 { data: Message[], meta }` |
| GET | `/messages/search` | `?q=&limit&cursor` — across all of the caller's conversations | any | `200 { data: (Message & { conversation: { id, name, type } })[], meta }` |
| PATCH | `/messages/:id` | `{ content }` | sender only, within 15 minutes, not deleted | `200 { data: Message }` |
| DELETE | `/messages/:id` | — | sender, or OWNER/ADMIN of the group | `204` |
| PUT | `/messages/:id/reactions` | `{ emoji }` | member | `200 { data: Message }` |
| DELETE | `/messages/:id/reactions/:emoji` | — | the reactor | `200 { data: Message }` |

Validation: `content` 1–4000 chars after trimming (may be empty only when
`attachmentIds` is non-empty); `clientId` UUID; `attachmentIds` ≤ 10, each must have
been uploaded by the caller and not yet attached.

Content is stored as plain text and rendered by React as text nodes — it is never
interpreted as HTML on either side, which is what prevents stored XSS.

## Attachments

| Method | Path | Body | Success |
|---|---|---|---|
| POST | `/attachments` | multipart `file` (≤ 10 MB; images, PDF, plain text, common Office formats, zip) | `201 { data: Attachment }` |
| GET | `/attachments/:id/download` | — | Binary. Caller must be a member of the conversation the attachment's message belongs to (or the uploader, if unattached). Sent with `Content-Disposition`, `X-Content-Type-Options: nosniff`; non-image types are forced to `attachment`. |

Because `<img>` tags cannot send an `Authorization` header, the frontend fetches
attachments with Axios as blobs and displays them through object URLs.

## Notifications

| Method | Path | Success |
|---|---|---|
| GET | `/notifications` `?unreadOnly&limit&cursor` | `200 { data: Notification[], meta: { nextCursor, unreadCount } }` |
| PATCH | `/notifications/:id/read` | `200 { data: Notification }` |
| POST | `/notifications/read-all` | `204` |

## Changes from the original brief

The endpoints listed in the brief are all present. Additions, and why:

- `auth/me`, `auth/sessions`, `auth/logout-all`, `auth/change-password` — session management.
- `users/:id/block`, `users/blocks`, `users/avatar` — block/unblock and profile pictures.
- `conversations/:id` `PATCH`, `/avatar`, `/leave`, `/read`, member `DELETE`/`PATCH`, `/attachments` — group administration, read cursor, shared media.
- Reactions and both search endpoints — required features with no endpoint in the brief.
- `attachments` — file upload and authorized download.
- `health` — required for deployment.
