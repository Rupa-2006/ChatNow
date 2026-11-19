# ChatNow — Testing Strategy & Results

ChatNow is tested across four layers: fast isolated unit tests, real PostgreSQL + Redis integration tests, multi-instance Redis Pub/Sub tests, and multi-user Playwright end-to-end browser tests.

---

## 1. Test Coverage Matrix

| Category | Suite / File | Environment Required | Cases Covered |
|---|---|---|---|
| **Backend unit — Auth & Crypto** | `backend/tests/unit/password.test.ts`, `tokens.test.ts`, `validators.test.ts` | None | Argon2id hashing/verification, JWT signing/expiry/algorithm-confusion/tampering, Zod input normalization & validation |
| **Backend unit — HTTP & Logging** | `backend/tests/unit/app.test.ts`, `logger.test.ts`, `phase5.test.ts` | None | Error envelope, malformed JSON, 413 body cap, auth boundaries, Pino & Logstash TCP redaction (zero secrets/content) |
| **Backend unit — Messaging & Security** | `backend/tests/unit/phase4.test.ts`, `security.test.ts` | None | Magic-byte file sniffing & spoofed HTML/EXE rejection, filename sanitization, receipt tick derivation, reaction grouping, directKey, 401 checks on all 24 Phase 4 routes, Helmet headers, CORS rejection, socket rate-limit buckets, 2 MB / 10 MB Multer caps |
| **Backend integration — Auth & Users** | `backend/tests/integration/auth.test.ts`, `users.test.ts` | PostgreSQL + Redis (`docker compose up -d postgres redis`) | Registration, login, refresh rotation, reuse/theft detection revoking session family, concurrent refresh race grace window, session list/revoke, password change, trigram user search, blocking |
| **Backend integration — Messaging & Sockets** | `backend/tests/integration/messaging.test.ts` | PostgreSQL + Redis | Socket JWT handshake rejection, real-time 1:1 messaging, typing indicators, `sent → delivered → read` ticks, persistence on reload, group OWNER/ADMIN/MEMBER RBAC & ownership transfer on leave |
| **Backend integration — Multi-Instance Redis** | `backend/tests/integration/multi-instance.test.ts` | PostgreSQL + Redis | Two isolated servers (`api-1` & `api-2`) with `@socket.io/redis-adapter`: cross-instance message delivery, typing, read receipts — plus negative proof that two servers without Redis adapter do not relay |
| **Backend integration — Security & Concurrency** | `backend/tests/integration/security.test.ts` | PostgreSQL + Redis | IDOR 404 isolation across conversations/messages/search/attachments, spoofed `.png` HTML upload rejection (415), block-evasion via group creation (403), concurrent direct chat & duplicate `clientId` races, 10 parallel messages, WebSocket flood rate-limiting & abuse disconnect |
| **Frontend unit & component tests** | `frontend/src/test/*.test.{ts,tsx}` | None (jsdom) | In-memory token handling, silent refresh bootstrap, login/register validation & server conflict error mapping, protected route guards, People directory → direct chat open, optimistic message send reconciliation, theme toggle, Settings active sessions |
| **End-to-end multi-user journeys** | `frontend/e2e/chatnow.spec.ts` | Full stack running (`:5174` / `:8080`) | Two simultaneous Playwright browser contexts (Alice & Bob): register, silent-refresh reload with zero tokens in `localStorage`, instant messaging, reload persistence, dark theme toggle, logout |

---

## 2. Recorded Verification Results (2026-11-18)

### Executed & Passing (No Docker Required)

| Command | Result |
|---|---|
| `backend`: `npm run typecheck` (`tsc --noEmit`) | **Passed** (0 errors) |
| `backend`: `npm run build` (`tsc -p tsconfig.build.json`) | **Passed** (0 errors) |
| `backend`: `npm test` (8 unit test files) | **107 / 107 passed** |
| `frontend`: `npm run typecheck` (`tsc -b --noEmit`) | **Passed** (0 errors) |
| `frontend`: `npm run build` (Vite 8 production bundle) | **Passed** (0 errors) |
| `frontend`: `npm test` (5 component/store test files) | **14 / 14 passed** |
| Root: `docker compose --profile full --profile elk config --quiet` | **Passed** (exit 0) |

### Live-Infrastructure Suites (Run Once Docker Desktop Is Started)

```powershell
# 1. Start PostgreSQL (5434) and Redis (6379)
cd c:\Projects\Chatbot
docker compose up -d postgres redis

# 2. Run ALL backend integration, Socket.IO, multi-instance Redis, and security tests
cd c:\Projects\Chatbot\backend
npm run test:integration

# 3. Install Playwright Chromium once and run multi-user E2E tests (with backend + frontend running)
cd c:\Projects\Chatbot\frontend
npm install
npx playwright install chromium
npm run test:e2e
```
