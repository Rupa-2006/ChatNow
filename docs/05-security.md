# ChatNow — Security Architecture & Review

This document describes ChatNow's defense-in-depth security posture, maps all 18 security controls to their exact implementation files, and records findings from the Phase 6 security review.

> **Honest encryption claim:** ChatNow encrypts network traffic in transit via **HTTPS / WSS (TLS 1.2/1.3)**. It does **not** implement end-to-end encryption (E2EE) — the application server can read message content to support server-side full-text search, delivery, and moderation.

---

## 1. Security Controls Matrix

| # | Control | Implementation | File(s) |
|---|---|---|---|
| 1 | **Password hashing** | Argon2id (`argon2`), memory-hard parameters, dummy verification on unknown-user login to eliminate user-enumeration timing leaks. Password policy follows NIST SP 800-63B (10–128 chars). | `backend/src/utils/password.ts`, `backend/src/services/auth.service.ts` |
| 2 | **JWT verification** | Short-lived 15 min HS256 JWTs with pinned `algorithms: ['HS256']`, `issuer`, and `audience` (prevents `alg: none` & algorithm confusion). Kept strictly in JS memory on the client — never `localStorage`. | `backend/src/utils/tokens.ts`, `frontend/src/services/http.ts` |
| 3 | **Session rotation & theft detection** | Opaque 256-bit refresh token in `HttpOnly; Secure; SameSite=Strict; Path=/api/auth` cookie. Only its SHA-256 hash is stored in `RefreshToken`. Rotated on every use; presenting a previously rotated token outside the 10 s concurrent-tab grace window revokes the entire session family and flags it in Redis. | `backend/src/controllers/auth.controller.ts`, `backend/src/services/auth.service.ts`, `backend/src/services/session.service.ts` |
| 4 | **Authorization middleware** | Every protected REST route verifies JWT signature/expiry **and** checks Redis revocation (`isSessionRevoked`). | `backend/src/middleware/authenticate.ts` |
| 5 | **Role-based access control (RBAC)** | Strict `OWNER` / `ADMIN` / `MEMBER` permission matrix enforced inside `conversation.service.ts` and `message.service.ts` — never trusted from frontend flags. | `backend/src/services/conversation.service.ts`, `backend/src/services/message.service.ts` |
| 6 | **Private conversation isolation** | Every conversation/message/attachment read/write checks `ConversationMember (leftAt IS NULL)`. Non-members receive `404 NOT_FOUND` (not `403`) to prevent UUID existence probing. | `backend/src/services/conversation.service.ts` (`requireActiveMembership`) |
| 7 | **Group membership validation** | Re-checked in PostgreSQL on both REST and Socket.IO handlers. Removed members are immediately ejected from `conversation:{id}` rooms via Redis adapter `socketsLeave`. | `backend/src/services/conversation.service.ts`, `backend/src/sockets/hub.ts` |
| 8 | **Rate limiting** | Shared Redis-backed `express-rate-limit` (`authStrict` 10/15m, `authRefresh` 60/15m, `search` 60/m, `uploads` 20/10m, `api` 300/m) + per-user Socket.IO Redis rate limiter (20 msg/10s, 60 typing/m, 120 other/m, disconnect + audit after 5 strikes). | `backend/src/middleware/rateLimit.ts`, `backend/src/sockets/rateLimit.ts` |
| 9 | **Input validation & XSS defense** | Strict Zod schemas on every REST body/query/param and every Socket.IO payload. Messages are stored as plain text and rendered as React text nodes (no `dangerouslySetInnerHTML`). | `backend/src/validators/*.ts` |
| 10 | **Secure HTTP headers** | Helmet (`defaultSrc 'none'`, `frameAncestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Powered-By` disabled) + edge Nginx security headers + HSTS in TLS config. | `backend/src/app.ts`, `infrastructure/nginx/nginx.tls.conf` |
| 11 | **CORS policy** | Explicit allow-list from `CORS_ORIGINS`, credentials enabled only for listed origins. Production runs behind single-origin Nginx so no cross-origin CORS is required. | `backend/src/app.ts`, `infrastructure/nginx/nginx.conf` |
| 12 | **SQL injection prevention** | Prisma parameterized queries everywhere; raw SQL for trigram user search and full-text message search uses `Prisma.sql` bound parameters (`escapeLike` for wildcard escaping) — zero string interpolation. | `backend/src/services/user.service.ts`, `backend/src/services/message.service.ts` |
| 13 | **WebSocket authentication** | JWT verified during Socket.IO handshake + Redis session revocation check + DB user existence check + scheduled disconnect at JWT `exp` + live `auth:refresh`. | `backend/src/sockets/index.ts` |
| 14 | **WebSocket event authorization** | `socket.data.userId` is set once from the verified JWT and never read from client payloads. Every event delegates to the same authorized service functions as REST. | `backend/src/sockets/index.ts` |
| 15 | **Secure file upload validation** | Multer size caps (10 MB attachments, 2 MB avatars), **magic-byte content sniffing** (`fileSniff.ts`) rejecting spoofed HTML/SVG/executables, random UUID storage keys outside webroot, path-traversal guard, authorized download route with `nosniff` & `Content-Disposition`. | `backend/src/utils/fileSniff.ts`, `backend/src/services/attachment.service.ts` |
| 16 | **Unauthorized room access prevention** | Clients have **no** `room:join` event. Rooms (`user:{id}`, `conversation:{id}`) are exclusively server-assigned at connect time and updated via `socketsJoin`/`socketsLeave`. | `backend/src/sockets/index.ts`, `backend/src/sockets/hub.ts` |
| 17 | **Audit & redacted observability logging** | Append-only `AuditLog` table for auth/session/block/group/moderation/abuse events. Pino `REDACT_PATHS` + Logstash `remove_field` ensure passwords, tokens, cookies, headers, and message `content` are never logged. | `backend/src/services/audit.service.ts`, `backend/src/config/logger.ts`, `infrastructure/elk/logstash/pipeline/chatnow.conf` |
| 18 | **Secrets & HTTPS/WSS deployment** | All secrets loaded from `.env` (git-ignored) and validated at startup via Zod (`env.ts`). Production TLS 1.2/1.3 Nginx config provided in `infrastructure/nginx/nginx.tls.conf`. | `backend/src/config/env.ts`, `.gitignore`, `infrastructure/nginx/nginx.tls.conf` |

---

## 2. Phase 6 Security Audit Findings & Fixes

During the Phase 6 manual code review, two subtle authorization edge cases were identified and fixed before closing the phase:

1. **Orphan disk write before RBAC check on group avatar upload (`MEDIUM`)**
   - *Issue*: `conversation.controller.ts` checked conversation membership (`getConversationForViewer`) before writing the uploaded image to disk, then verified `OWNER`/`ADMIN` role inside `updateConversationAvatar`. A regular `MEMBER` could repeatedly fail with `403` while leaving orphan files on disk.
   - *Fix*: Added `assertCanManageGroup(userId, conversationId)` in `conversation.service.ts` and invoked it in `conversation.controller.ts` **before** `storeAvatarFile` touches the filesystem.

2. **Block-evasion via group creation / member addition (`LOW-MEDIUM`)**
   - *Issue*: `UserBlock` prevented direct conversations and direct messages, but a blocked user could still create a new group containing the user who blocked them.
   - *Fix*: Added `UserBlock` checks in `createConversation` (GROUP) and `addGroupMembers` rejecting attempts to add a user who has blocked the actor with `403 FORBIDDEN` (covered by `tests/integration/security.test.ts`).

---

## 3. Residual Risks & Production Hardening Checklist

- **Unattached upload garbage collection**: Attachments uploaded via `POST /api/attachments` that are never linked to a message (`messageId IS NULL`) should be pruned by a scheduled cron job (e.g., older than 24 hours).
- **Object storage in production**: Replace local disk volume (`UPLOAD_DIR`) with S3 / Cloudflare R2 + short-lived signed URLs for horizontal cloud scaling.
- **TLS certificates**: In self-hosted Docker deployments, terminate TLS with Let's Encrypt / Certbot using `infrastructure/nginx/nginx.tls.conf` and set `COOKIE_SECURE=true`.
- **Dependency hygiene**: Run `npm audit` regularly and apply non-breaking patches before every release.
