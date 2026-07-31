---
# Code Flags — Doc-Correct Discrepancies

Generated: 2026-07-16
Source: Full doc maintenance pass — docs synced to code, flags for code fixes.

Each flag: If the code matches the doc, no flag. If code differs and
the DOC describes the correct behavior, flag it here for a code agent.

---

## Flag 1: `x-api-key` and `?api_key=` auth not supported on general endpoints

**Source doc:** `/docs/core/server.md` — Authentication section
**Doc requirement:** "All endpoints except `/api/v1/health` and `/api/v1/getClientConfig` require API key authentication."

The doc has been updated to match current code (only `Authorization: Bearer` works), but this is a **regression from intended design**. The original spec explicitly listed three auth mechanisms:

- `Authorization: Bearer`
- `x-api-key` header
- `?api_key=` query parameter

Only Bearer is actually implemented in `apiKeyMiddleware`. The `verifySignedOrApiKey` middleware (used for file access) does support all three.

**Code location:** `server/src/index.ts` — `apiKeyMiddleware` function (around line 373)
**What code does:** Only checks `authorization` header (case-insensitive), ignores `x-api-key` and `api_key`/`apiKey` query params.
**Resolution:** Add `x-api-key` header and `api_key`/`apiKey` query param checks to `apiKeyMiddleware`, matching `verifySignedOrApiKey` pattern.
**Status:** resolved ✅

---

## Flag 2: `POST /api/v1/sign-file` endpoint missing

**Source doc:** `/docs/core/server.md` — API Reference (removed from synced doc as it doesn't exist in code)
**Doc requirement (from original):** There should be a `/api/v1/sign-file` endpoint that generates a signed URL for an existing file.

The signing functions (`generateSignature`, `generateSignedUrl`) exist as internal helpers but there's no public endpoint.

**Code location:** `server/src/index.ts` — no route for `/api/v1/sign-file`
**What code does:** No public endpoint exists. Clients can't request a signed URL for an arbitrary file.
**Resolution:** Add `POST /api/v1/sign-file` route that accepts `{ filename, expiresIn }` and returns `{ success, url }`.
**Status:** resolved ✅

---

## Flag 3: Missing `userId`, `longPoll`, `timeout` params on `getMessages`

**Source doc:** `/docs/core/server.md` — GET /api/v1/getMessages
**Doc requirement:** The endpoint should support `userId` (optional filter), `longPoll` (boolean, enable long-polling), and `timeout` (long-poll timeout) query parameters.

**Code location:** `server/src/controllers/messageController.ts` — `getMessages` function (around line 144)
**What code does:** Only reads `botId`, `roomId`, `cursorId`, `limit`, `types` — ignores `userId`, `longPoll`, `timeout`.
**Resolution:** Add `userId` filter support, and `longPoll`/`timeout` parameters to enable long-polling directly on `getMessages`.
**Status:** resolved ✅

---

## Flag 4: Missing indexes on Message schema

**Source doc:** `/docs/core/server.md` — Database Schema
**Doc requirement:** Indexes on `[botId, userId]` and `[createdAt]` for query performance.

**Code location:** `server/prisma/schema.prisma` — Message model
**What code does:** Only has `@@index([botId, roomId])`. Missing `@@index([botId, userId])` and `@@index([createdAt])`.
**Resolution:** Add the two missing index definitions to the Message model in schema.prisma.
**Status:** resolved ✅

---

## Flag 5: `addMessageSingle` missing rate limiter

**Source doc:** `/docs/core/server.md` — Rate Limiting
**Doc requirement:** All endpoints MUST have rate limiting.

**Code location:** `server/src/index.ts` — `addMessageSingle` route (around line 852)
**What code does:** Does NOT apply `uploadLimiter` middleware (unlike `/api/v1/uploadFile` and `/api/v1/uploadFileByURL` which both use it).
**Resolution:** Add `uploadLimiter` middleware to the `addMessageSingle` route definition.
**Status:** resolved ✅

---

## Flag 6: `getMessages` default limit mismatch (20 vs 50)

**Source doc:** `/docs/core/server.md` — GET /api/v1/getMessages
**Doc requirement:** Default limit should be 50 for consistency with `getRooms` pagination.

**Code location:** `server/src/controllers/messageController.ts` — line `take: opts.limit ?? 20`
**What code does:** Uses 20 as default.
**Resolution:** Change default from 20 to 50, or consider making it configurable.
**Status:** resolved ✅ (low priority — subjective)
