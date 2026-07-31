# Changelog

All notable changes to Botoraptor will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [4.0.0] - 2026-07-31

### Changed

- Reorganized product code under `apps/server` and `apps/web`.
- Reorganized copyable SDK source under `sdk-templates/{node,python,go,php}`.
- Standardized direct and Docker persistence on `data/config`, `data/db`, and
  `data/uploads`.
- Added a pinned-Corepack lifecycle launcher with `start`, `install`, `update`,
  `status`, `backup`, and `rollback` commands.
- The server now serves the built UI from `apps/web/dist`; API endpoint paths and
  response behavior remain unchanged.
- Bumped the root, server, web, Node SDK, and Python SDK package versions to
  `4.0.0`. Go and PHP remain source templates without normal package version
  fields.

### Added

- Non-destructive legacy migration for v3 config, environment, database, uploads,
  and practically detectable legacy Docker volumes.
- Backup-before-update, health verification, release markers, and an operator
  rollback path.
- [Standalone v4 migration manual](private/MIGRATION-v4.md).

See [MIGRATION-v4.md](private/MIGRATION-v4.md) for the complete operator procedure.

## [3.3.0] - 2026-07-30

### Added

- **`event` message type**: New `event` value in `MessageType` for event-driven notifications and system events.
- **`tags` field on messages**: Messages now accept an optional `tags` (string array) field for arbitrary classification and filtering.
- **`tags` filter in `getRooms`**: Pass `?tags=tag1,tag2` (comma-separated) to filter rooms by message tags. Combines with `messageType` using AND logic.
- **Dedicated auth page** (`/auth`): New `AuthPage.vue` with URL key validation (`?api_key=...`), deeplink intent saving, and error states (e.g., invalid key).
- **Auth guard for all routes**: Router now validates API keys before navigation. URL-provided keys are validated and cleaned from the address bar. Unauthenticated users are redirected to `/auth`.

### Changed

- **All four SDKs synced** with `tags` support:
  - Node SDK: `tags` in `Message` type, `tags` param in `getRooms`
  - Go SDK: `Tags` in `Message`/`AddMessageInput` structs, `Tags` in `GetRoomsOptions`
  - Python SDK: `EVENT` enum value, `tags` in `Message` model, `tags` param in `get_rooms`
  - PHP SDK: `tags` query param in `getRooms`
- **Database migration**: Added `tags` (JSON) column to `Message` table. Backfills missing indexes (`botId+userId`, `createdAt`) from v3.2.0.
- **Version bumped** to 3.3.0 across server, web UI, and all SDK packages for consistency.
- **Web UI polish**: ChatList search/filter improvements, ChatView enhancements, theme variable additions, locale updates across all 8 languages.

### Upgrade Guide

**Upgrading from 3.2.0:**

1. **Pull latest changes**

2. **Run database migration** (server):
   ```bash
   cd server && pnpm run migrate:prod
   ```
   This adds the `tags` column and any missing indexes. No data loss — additive only.

   > **Note:** Starting with v3.3.0, Prisma migrations are tracked in the repository. If you were previously using `prisma db push`, you can continue doing so, or switch to `prisma migrate deploy`. New installs will use `migrate deploy` by default.

3. **Install/update dependencies**:
   ```bash
   cd server && pnpm install
   ```

4. **Update SDK packages** (if using):
   - Node: `pnpm install` (fetches updated `chatLayerSDK.ts`)
   - Python: `pip install --upgrade chatlayersdk-python`
   - Go: `go get github.com/lirrensi/Botoraptor/chatLayerSDK_go@v3.3.0`
   - PHP: Replace `Botoraptor.php` with the updated file

5. **Rebuild Web UI** (if using):
   ```bash
   cd web_ui && pnpm run build
   ```

6. **Restart server**

---

## [3.2.0] - 2026-07-16

### Added

- **Multi-method API key auth**: `apiKeyMiddleware` now accepts `x-api-key` header and `api_key`/`apiKey` query parameters in addition to `Authorization: Bearer` (matching the existing `verifySignedOrApiKey` pattern).
- **`POST /api/v1/sign-file` endpoint**: Generate signed URLs for stored files via public API.
- **`getMessages` long-polling mode**: Pass `?longPoll=true` to wait for new messages directly on the messages endpoint, with optional `userId` filter and `timeout` parameter.
- **Database indexes**: Added `@@index([botId, userId])` and `@@index([createdAt])` to Message schema for query performance.

### Fixed

- **`addMessageSingle` rate limiting**: Added missing `uploadLimiter` middleware to the route, aligning with `uploadFile` and `uploadFileByURL`.

### Changed

- **`getMessages` default limit**: Increased from 20 to 50 for consistency with `getRooms` pagination. Clients passing an explicit `limit` parameter are unaffected.
- **SDK documentation synced**: All four NSDK docs (Python, Node, Go, PHP) corrected to match actual code signatures, types, and defaults. Python Quick Start now uses correct `Message` object-based API.

---

## [3.1.0] - 2026-02-23

### Security

- **SSRF Protection**: Added protection against Server-Side Request Forgery in `uploadFileByURL` endpoint. Blocks requests to cloud metadata endpoints (AWS/GCP/Azure/Alibaba).
- **Rate Limiting**: Added rate limits to all API endpoints:
  - General: 100 requests/minute
  - Long-polling: 10 connections/minute
  - File uploads: 20 requests/minute
- **Security Headers**: Added Helmet middleware for security headers (X-Frame-Options, Content-Security-Policy, etc.)
- **CORS Configuration**: CORS now requires explicit origin configuration. Empty array = CORS disabled. See README for setup instructions.
- **Dangerous File Warnings**: Web UI now warns users about potentially dangerous file extensions (.exe, .bat, .ps1, etc.)

### Fixed

- **Memory Exhaustion**: `getRooms` endpoint now uses pagination (max 500 rooms) instead of loading all messages into memory.
- **N+1 Query**: Fixed N+1 query pattern in `getRooms` — users are now fetched in a single batch query.

### Changed

- **Documentation Reorganized**: All architecture docs consolidated into central `docs/` directory. Component-level `docs/` folders removed.
- **CORS Required for Cross-Origin**: Web UI hosted on a different domain now requires `corsOrigins` configuration in `server/config/server.json`.

### Added

- Root `.editorconfig` for consistent code style across editors
- Root `.env.example` documenting required environment variables
- `dangerousExtensions` field in client config

---

## [3.0.0] - 2026-02-XX

### Added

- Initial public release
- Server: Express.js + TypeScript + SQLite
- Web UI: Vue 3 + Ionic for manager interface
- Node SDK: TypeScript client for bots
- Python SDK: Async Python client for bots
- Docker support with docker-compose
- Long-polling for real-time updates
- Webhook support for external integrations
- File upload with signed URLs

---

## Upgrade Guide

### Upgrading to 3.1.0

1. **Pull latest changes**

2. **Install new dependencies** (server):
   ```bash
   cd server && pnpm install
   ```

3. **Configure CORS** (required if Web UI is on different domain):
   ```json
   // server/config/server.json
   {
     "corsOrigins": ["https://your-webui-domain.com"]
   }
   ```

4. **Rebuild Web UI** (if using):
   ```bash
   cd web_ui && pnpm run build
   ```

5. **Restart server**

---

[4.0.0]: https://github.com/lirrensi/Botoraptor/compare/v3.3.0...v4.0.0
[3.3.0]: https://github.com/lirrensi/Botoraptor/compare/v3.2.0...v3.3.0
[3.2.0]: https://github.com/lirrensi/Botoraptor/compare/v3.1.0...v3.2.0
[3.1.0]: https://github.com/lirrensi/Botoraptor/compare/v3.0.0...v3.1.0
[3.0.0]: https://github.com/lirrensi/Botoraptor/releases/tag/v3.0.0
