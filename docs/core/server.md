---
node_type: architecture
title: Server Architecture & API Reference
status: active
updated: 2026-08-01
tags: [server, architecture, api, typescript, lifecycle, deployment]
links:
  depends_on: [/overview/product.md]
  documents: [/apps/server/src/]
  relates_to: [/core/web-ui.md, /nsdks/node.md, /nsdks/python.md, /nsdks/go.md, /nsdks/php.md]
---

# Server Architecture & API Reference

Backend API for Botoraptor — Express.js + TypeScript + SQLite.

---

## Overview

The server is a self-contained REST API that handles message storage, real-time updates via long-polling, webhook dispatch, and file uploads. It serves the Web UI as static files.

Public branding uses `Botoraptor`; the v4 repository paths are canonical and no old source-tree compatibility aliases are maintained.

**Scope Boundary:**

- **This component owns**: HTTP routing, message CRUD, long-polling connections, webhook dispatch, file storage, database operations
- **This component does NOT own**: Bot logic, message delivery to end users, UI rendering
- **Boundary interfaces**: Receives messages from SDKs, serves UI to browsers, dispatches webhooks to external services

---

## Project Structure

```
apps/server/
├── src/
│   ├── index.ts              # Express app, routes, middleware
│   ├── runtimePaths.ts       # Resolves the shared data/ contract at runtime
│   ├── prismaClient.ts       # Prisma singleton
│   ├── swagger.ts            # OpenAPI configuration
│   ├── controllers/
│   │   └── messageController.ts  # Message CRUD operations
│   └── helpers/
│       ├── logpollManager.ts     # Long-polling implementation
│       └── ssrfProtection.ts     # SSRF URL validation
├── prisma/
│   └── schema.prisma         # Database schema
├── config/
│   ├── server.json           # Bundled server configuration defaults
│   └── client.json           # Bundled client configuration defaults
├── package.json
├── tsconfig.json
└── ecosystem.config.cjs      # Legacy PM2 file — NOT used by the v4 launcher

tools/
└── botoraptor.mjs            # Lifecycle launcher: install, start, update,
                              # status, rollback, backup, docker-update

data/                         # Persistent state — the only mutable directory
├── config/                   # Mutable server/client JSON configuration
├── db/botoraptor.db          # Persistent SQLite database
├── uploads/                  # Persistent uploaded files
├── .env                      # Runtime secret (FILE_SIGNING_SECRET) and values
├── backups/                  # Timestamped update/rollback backups
├── release.json              # Release + rollback marker
├── server.log                # Managed direct-mode server output
├── server.pid                # Managed server process record
└── .lifecycle.lock           # Lifecycle operation serialization lock
```

---

## Technology Stack

| Technology | Version (range) | Purpose |
|------------|----------------|---------|
| TypeScript | ^5.7 | Type-safe JavaScript |
| Express.js | ^5.1 | Web framework |
| Prisma | ^7.3 | Database ORM |
| SQLite | — | Embedded database |
| Multer | — | File upload handling |
| swagger-jsdoc | — | API documentation |
| Helmet | — | Security headers |
| express-rate-limit | — | Rate limiting |

---

## Database Schema

### Prisma Schema (`prisma/schema.prisma`)

```prisma
model User {
  id        Int      @id @default(autoincrement())
  botId     String
  userId    String
  username  String
  name      String?
  blocked   Boolean  @default(false)
  createdAt DateTime @default(now())

  messages Message[] @relation("UserMessages")

  @@unique([botId, userId])
}

model Message {
  id          Int      @id @default(autoincrement())
  botId       String
  roomId      String
  userId      String
  text        String
  messageType String
  attachments Json?
  meta        Json?
  tags        Json?
  createdAt   DateTime @default(now())

  user User @relation("UserMessages", fields: [userId, botId], references: [userId, botId])
  tagIndex MessageTag[]

  @@index([botId, roomId, createdAt, id])
  @@index([botId, messageType, roomId, createdAt, id])
  @@index([botId, createdAt, id])
  @@index([botId, userId])
  @@index([botId])
  @@index([messageType])
  @@index([createdAt])
}

model MessageTag {
  id        Int      @id @default(autoincrement())
  messageId Int
  botId     String
  roomId    String
  tag       String
  createdAt DateTime
  message   Message  @relation(fields: [messageId], references: [id], onDelete: Cascade)

  @@unique([messageId, tag])
  @@index([botId, tag, createdAt, messageId])
  @@index([botId, roomId, tag, createdAt, messageId])
  @@index([tag])
}
```

### MessageType Enum

| Value | Description |
|-------|-------------|
| `user_message` | User typed a message to the bot |
| `user_message_service` | User interaction with bot features |
| `bot_message_service` | Automated bot response |
| `manager_message` | Message from a human operator |
| `service_call` | Special event requesting human takeover |
| `error_message` | System error or failure notification |

### Indexes

| Index | Fields | Purpose |
|-------|--------|---------|
| Primary | `id` | Unique message identifier (auto-increment) |
| Room | `botId, roomId, createdAt, id` | Room-scoped lookups and latest-message ordering within a room |
| User | `botId, userId` | Filter messages by user within a bot |
| Message order | `botId, createdAt, id` | Latest-message room ordering and timestamp cursors |
| Message type | `botId, messageType, roomId, createdAt, id` and `messageType` | Type-filtered candidates and global type options |
| Normalized tags | `botId, tag, createdAt, messageId` | Indexed tag-filtered message and room candidates |
| Room tags | `botId, roomId, tag, createdAt, messageId` | Tag matches constrained to a bot and room |
| Global options | `botId`, `messageType`, `tag` | Distinct bot, type, and tag option queries |
| Created | `createdAt` | Efficient time-ordered queries |

`Message.tags` and `Message.meta` remain source JSON for API compatibility. The
`MessageTag` table is the maintained normalized read index: message creation
writes its deduplicated normalized tags in the same Prisma transaction as the
message, and the additive production migration backfills supported legacy JSON
arrays, encoded arrays, comma-separated values, tag/metadata envelopes, and
arrays containing `{tag}` or `{tags}` objects.

---

## API Reference

### Authentication

All endpoints except `/api/v1/health` and `/api/v1/getClientConfig` require API key authentication.

**Accepted formats:**

```http
Authorization: Bearer your-api-key
x-api-key: your-api-key
GET /api/endpoint?api_key=your-api-key
```

The middleware checks `Authorization: Bearer` first, then falls back to the `x-api-key` header, then to `api_key`/`apiKey` query parameters. File access endpoints additionally support signed URL authentication.

### Response Format

**Success:**
```json
{
  "success": true,
  "data": { ... }
}
```

**Error:**
```json
{
  "success": false,
  "errorMessage": "Human-readable error message",
  "details": { ... }
}
```

---

### Endpoints

#### Health Check

```
GET /health
GET /api/v1/health
```

No authentication required. Returns server status. `/health` is the probe used
by the lifecycle launcher and the Docker healthcheck.

**Response:**
```json
{ "status": "ok" }
```

---

#### Validate API Key

```
GET /apiKeyCheck
```

Quick validation of an API key.

**Response:** `200 OK` if valid, `403 Forbidden` if invalid.

---

#### Get Client Configuration

```
GET /api/v1/getClientConfig
```

No authentication required. Returns client-side configuration.

**Response:**
```json
{
  "success": true,
  "data": {
    "quickAnswersPreset": ["Hello! Thanks for reaching out!", "I'll help you with that right away.", "Could you provide more details?"],
    "dangerousExtensions": [".exe", ".bat", ".cmd", ".ps1", ".sh", ".js", ".vbs", ".jar", ".msi", ".scr", ".pif", ".com", ".lnk"]
  }
}
```

---

#### Add Message

```
POST /api/v1/addMessage
```

Create a new message. Requires authentication.

**Request Body:**
```json
{
  "botId": "my-bot",
  "roomId": "room-123",
  "userId": "user-456",
  "username": "john_doe",
  "name": "John Doe",
  "text": "Hello, world!",
  "messageType": "user_message",
  "attachments": [
    {
      "type": "image",
      "url": "https://example.com/image.jpg"
    }
  ],
  "meta": { "custom": "data" }
}
```

**Required Fields:**
- `botId` (string) — Bot identifier
- `roomId` (string) — Room/conversation identifier
- `userId` (string) — User identifier
- `username` (string) — Display name

**Optional Fields:**
- `name` (string) — Full name
- `text` (string) — Message text
- `messageType` (string) — Message type enum value
- `attachments` (array) — Attachment objects
- `meta` (object) — Custom metadata

**Response:** `201 Created`
```json
{
  "success": true,
  "message": {
    "id": 1,
    "botId": "my-bot",
    "roomId": "room-123",
    "userId": "user-456",
    "text": "Hello, world!",
    "messageType": "user_message",
    "createdAt": "2026-01-31T12:00:00.000Z"
  }
}
```

**Side Effects:**
- Creates user if not exists
- Notifies long-poll listeners
- Triggers webhooks if `messageType === "manager_message"`

---

#### Add Message with File

```
POST /api/v1/addMessageSingle
```

Create a message with a single file upload in one request. Multipart/form-data.

**Form Fields:** Individual fields (`botId`, `roomId`, `userId`, `username`, `name`, `messageType`, `text`, `meta`, `file`, `type`, `filename`)

**Response:** Same as `addMessage` with populated `attachments`.

---

#### Get Messages

```
GET /api/v1/getMessages
```

Fetch messages with pagination.

**Query Parameters:**
- `botId` (string, required) — Bot identifier
- `roomId` (string, optional) — Filter by room
- `userId` (string, optional) — Filter by user
- `limit` (number, default: 50) — Max messages to return
- `cursorId` (string, optional) — Pagination cursor (message ID); its timestamp and ID tie-break are used with the newest-first order
- `types` (string, optional) — Comma-separated message types to filter
- `tags` (string, optional) — Comma-separated tags; values are ORed within the tag group and ANDed with message type filters
- `longPoll` (boolean, optional) — Enable long-polling mode; waits for new messages instead of returning immediately
- `timeout` (number, optional) — Long-poll timeout in milliseconds (default: 60000)

**Response:**
```json
{
  "success": true,
  "messages": [
    { "id": 1, "text": "...", "createdAt": "..." },
    { "id": 2, "text": "...", "createdAt": "..." }
  ]
}
```

**Pagination:**
- Messages returned newest-first (descending by `createdAt`)
- Use `cursorId` from the last message to fetch older messages
- Empty array means no more messages

---

#### Get Updates (Long-Polling)

```
GET /api/v1/getUpdates
```

Long-polling endpoint for real-time updates.

**Query Parameters:**
- `botIds` (string, optional) — Comma-separated bot IDs to listen for
- `botId` (string, optional) — Legacy singular alias for `botIds`
- `listenerType` (string, default: `"bot"`) — Either `"bot"` or `"ui"`
- `timeoutMs` (number, default: 60000) — Max wait time in ms

**Listener Types:**
- `bot` — Receives `manager_message` events (for bots to deliver to users)
- `ui` — Receives all message events (for manager UI)

**Response:**
```json
{
  "success": true,
  "messages": [
    { "id": 1, "botId": "...", "roomId": "...", "text": "..." }
  ]
}
```

**Behavior:**
- Blocks until new message arrives or timeout
- Returns immediately if messages available
- Client should reconnect after each response

---

#### Get Bots

```
GET /api/v1/getBots
```

List all unique bot IDs in the database.

**Response:**
```json
{
  "success": true,
  "bots": ["bot-1", "bot-2", "bot-3"]
}
```

---

#### Get Filter Options

```
GET /api/v1/getFilterOptions
```

Protected endpoint returning distinct `messageTypes` and normalized `tags` discovered from **all persisted messages**. It is intentionally not scoped to a bot so the inbox can render complete option lists before applying filters to the selected bot's rooms.

**Response:**
```json
{
  "success": true,
  "messageTypes": ["event", "user_message"],
  "tags": ["priority", "vip"]
}
```

Tag values are normalized from legacy JSON arrays (including arrays containing `{tag}` or `{tags}` objects), JSON-encoded strings, comma-separated strings, and nested tag/metadata envelopes; null and malformed values are ignored safely.

---

#### Get Rooms

```
GET /api/v1/getRooms
```

Get room information with pagination.

**Query Parameters:**
- `botId` (string, required) — Bot identifier
- `messageType` (string, optional) — Legacy singular message type filter
- `messageTypes` (string, optional) — Comma-separated message types; values are ORed within the message-type group
- `tags` (string, optional) — Comma-separated normalized tags; values are ORed within the tag group
- `depth` (number, default: 10) — Number of recent messages to check for each selected filter group
- `limit` (number, default: 50, max: 500) — Max rooms to return
- `cursorId` (string, optional) — Pagination cursor (message ID); rooms are returned from messages older than that message's timestamp

When filters are present, a room matches if at least one of the selected message types appears in its recent `depth` messages and/or at least one selected tag appears there. Message types are ORed, tags are ORed, and the two groups are ANDed when both are selected. The returned `lastMessage` remains the room's latest message and users remain room-scoped; filtering does not replace the conversation preview.

**Response:**
```json
{
  "success": true,
  "rooms": [
    {
      "botId": "bot-1",
      "roomId": "room-123",
      "users": [
        { "userId": "user-1", "username": "john" }
      ],
      "lastMessage": { "id": 1, "text": "...", "createdAt": "..." }
    }
  ]
}
```

**Performance:**
- Users are fetched in a single batch query (no N+1)
- `getMessages`, `getBots`, and `getFilterOptions` use indexed Prisma/SQLite queries and do not scan message history in Node
- `getRooms` uses a two-query candidate-first shape: room candidates come from the type and `MessageTag` indexes (or the bot's room set when unfiltered), correlated indexed recent-window checks stop at `depth`, matching rooms are ordered by their latest message with the cursor applied, and the latest-message rows are fetched by primary key in a second query before the batched user lookup
- Tag filters use `MessageTag`; there is no request budget, partial response, compatibility history fallback, or per-room filter query
- Max 500 rooms per request

---

#### Add User

```
POST /api/v1/addUser
```

Create or retrieve a user.

**Request Body:**
```json
{
  "botId": "my-bot",
  "userId": "user-123",
  "username": "john_doe",
  "name": "John Doe"
}
```

**Response:**
```json
{
  "success": true,
  "user": {
    "botId": "my-bot",
    "userId": "user-123",
    "username": "john_doe",
    "name": "John Doe",
    "blocked": false,
    "createdAt": "..."
  }
}
```

---

#### Upload File

```
POST /api/v1/uploadFile
```

Upload one or more files. Returns attachment metadata with signed URL.

**Request:** Multipart/form-data with `file` field (supports multiple files).

**Additional Fields (in body):**
- `type` (string, required) — One of: `image`, `video`, `document`, `file`

**Response:**
```json
{
  "success": true,
  "attachments": [
    {
      "id": "uuid",
      "type": "image",
      "url": "/uploads/uuid.jpg?signature=...",
      "filename": "image.jpg",
      "mime_type": "image/jpeg",
      "size": 12345
    }
  ]
}
```

---

#### Upload File by URL

```
POST /api/v1/uploadFileByURL
```

Upload files from remote URLs. Server downloads and stores them.

**Request Body:**
```json
{
  "files": [
    {
      "url": "https://example.com/image.jpg",
      "filename": "downloaded.jpg",
      "type": "image"
    }
  ]
}
```

**Response:** Same as `uploadFile`.

---

#### Get File

```
GET /uploads/:filename
```

Access uploaded files. Requires valid signature or API key.

**Authentication:**
- Signed URL with valid `signature` and `expires` query params
- OR API key in header

**Response:** File content with appropriate Content-Type.

**Error Codes:**
- 401 — Missing or invalid signature/API key
- 403 — Signed URL expired
- 404 — File not found

---

#### OpenAPI Spec

```
GET /api/v1/openapi.json
```

Returns the raw OpenAPI/Swagger specification.

---

#### SPA Fallback

```
GET /*
```

Any non-API route serves `index.html` for SPA client-side routing support.

---

## Long-Polling

### Architecture

The long-polling system is implemented in `src/helpers/logpollManager.ts`.

**How it works:**

1. Client makes request to `/api/v1/getUpdates`
2. Server creates a "listener" object and waits
3. When a new message is created, the route handler calls `notifyListeners` on the manager
4. Message-type filtering is done at the call site:
   - `manager_message` messages notify `"bot"` listeners
   - All other messages notify `"ui"` listeners
5. Matching listeners receive the message and respond to their clients
6. If timeout expires, server responds with empty array

### Listener Types

| Type | Receives | Used By |
|------|----------|---------|
| `bot` | `manager_message` only | Bots that need to deliver manager messages to users |
| `ui` | All messages | Manager web UI |

### Timeout Behavior

- Default timeout: 60 seconds
- Client should reconnect immediately after receiving response
- Exponential backoff recommended on errors

---

## Webhooks

### Configuration

Webhooks are configured in `data/config/server.json`:

```json
{
  "webhooks": [
    {
      "url": "https://your-domain.com/webhook",
      "headers": {
        "Authorization": "Bearer webhook-secret"
      },
      "query": { "source": "botoraptor" },
      "retry": {
        "attempts": 3,
        "delay_ms": 3000
      }
    }
  ]
}
```

### Trigger Conditions

Webhooks are triggered when a message with `messageType === "manager_message"` is created.

### Payload Format

```json
{
  "success": true,
  "messages": [
    {
      "id": 1,
      "botId": "bot-1",
      "roomId": "room-123",
      "userId": "manager",
      "text": "Hello from manager",
      "messageType": "manager_message",
      "createdAt": "2026-01-31T12:00:00.000Z"
    }
  ]
}
```

### Retry Logic

- Configurable retry attempts (default: 3)
- Delay between retries (default: 3000ms)
- Non-blocking: webhook failures don't affect message creation

---

## File Handling

### Storage

Files are stored in `data/uploads/` with UUID filenames.

**Naming Convention:**
- Server generates UUID for each file
- Original filename preserved in `original_name` field
- Extension preserved from original or detected MIME type

### Signed URLs

File access requires authentication via signed URLs:

```
/uploads/uuid.jpg?signature=abc123&expires=1234567890
```

**Signature Generation:**
```typescript
const signature = crypto
  .createHmac('sha256', FILE_SIGNING_SECRET)
  .update(`${filename}:${expires}`)
  .digest('hex');
```

**Verification:**
- Timing-safe comparison to prevent timing attacks
- Expiration timestamp checked
- Falls back to API key auth for admin access

### File Cleanup

A sweep job runs periodically to delete expired files:

- Files older than `fileTTLSeconds` are deleted
- Default TTL: 7 days (604800 seconds)
- Cleanup runs every hour

### Security

- **Path traversal prevention**: UUID filenames, no user input in path
- **MIME type detection**: From buffer content, not extension
- **Filename sanitization**: Dangerous characters removed
- **Size limits**: Configurable via `maxFileSize`

---

## Security Hardening

### Authentication

All endpoints except `/api/v1/health` and `/api/v1/getClientConfig` require API key authentication.

**Accepted formats:**
- `Authorization: Bearer <api-key>`
- `x-api-key: <api-key>`
- `?api_key=<api-key>` or `?apiKey=<api-key>` query parameter

**Key Management:**
- Keys are configured in `data/config/server.json` under `apiKeys` (string array)
- Each key grants full read/write access

### Rate Limiting

Rate limiting is applied to all endpoints:

| Endpoint Type | Limit | Window |
|---------------|-------|--------|
| General | 100 requests | 1 minute |
| Long-polling | 10 connections | 1 minute |
| File upload | 20 requests | 1 minute |

Implementation: `express-rate-limit` with sliding window.

### Security Headers

Server MUST apply security headers via `helmet()`:
- `Content-Security-Policy` — *disabled in production* (internal admin panel behind Apache auth; Helmet v8 default CSP blocks Vue SPA inline scripts)
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security` (HTTPS only)

### CORS

CORS MUST be configured via `corsOrigins` in `data/config/server.json`:

```typescript
app.use(cors({
  origin: config.corsOrigins ?? [],
  credentials: true
}));
```

Configuration:
- Empty array `[]` = CORS disabled (default)
- Array of origin strings = only those origins allowed
- Default: empty array (no CORS) for production

### SSRF Protection

`uploadFileByURL` endpoint validates URLs before fetching:

- Rejects non-http(s) protocols
- Blocks cloud metadata endpoints (AWS/GCP/Azure/Alibaba)

| Blocked IP/Host | Reason |
|-----------------|--------|
| `169.254.169.254` | AWS/GCP/Azure metadata |
| `metadata.google.internal` | GCP metadata |
| `100.100.100.200` | Alibaba metadata |

**Trust assumption**: API key holders are trusted. Other URLs are allowed.

---

## Configuration

### Server Configuration (`data/config/server.json`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | number | 31000 | Server port |
| `apiKeys` | string[] | — | Valid API keys |
| `corsOrigins` | string[] | [] | Allowed CORS origins (empty = CORS disabled) |
| `maxFileSize` | number | 10485760 | Max upload size in bytes (10MB) |
| `fileTTLSeconds` | number | 604800 | File lifetime in seconds (7 days) |
| `webhooks` | array | [] | Webhook configurations |

### Client Configuration (`data/config/client.json`)

| Field | Type | Description |
|-------|------|-------------|
| `quickAnswersPreset` | string[] | Pre-defined quick reply messages for managers |
| `dangerousExtensions` | string[] | File extensions flagged as potentially dangerous |

### Environment Variables

The server reads `data/.env` at startup (if present) and derives the remaining
runtime values from the shared `data/` contract. Values for `DATABASE_URL*` in
`.env` or elsewhere are ignored — the database location is owned by the
launcher so direct and Docker modes cannot diverge.

| Variable | Required | Description |
|----------|----------|-------------|
| `FILE_SIGNING_SECRET` | No | HMAC secret for file URLs; stored in `data/.env`. The launcher generates a random value when absent |
| `BOTORAPTOR_ROOT` | No | Repository root; the server resolves it when unset |
| `BOTORAPTOR_DATA_DIR` | No | Persistent data directory (defaults to `<repo>/data`) |
| `WEB_DIST_DIR` | No | Web build directory (defaults to `<repo>/apps/web/dist`) |
| `DATABASE_URL` / `_DEV` / `_PROD` | No | Set by the server at runtime from `data/db/botoraptor.db`; input values are ignored |
| `NODE_ENV` | No | Set to `production` by the launcher and Docker |
| `BOTORAPTOR_IMAGE` | No | `1` inside the production Docker image; skips install/build |
| `BOTORAPTOR_DOCKER_MODE` | No | `1` in Docker; routes rollback to the container-safe path |
| `BOTORAPTOR_LIFECYCLE_LOCK_HELD` | No | `1` for Docker one-shot lifecycle commands (lock already held) |
| `BOTORAPTOR_LEGACY_CONFIG_DIR` | No | Overrides the legacy config import source (v3→v4 migration) |
| `BOTORAPTOR_LEGACY_DB_DIR` | No | Overrides the legacy database import source (v3→v4 migration) |
| `BOTORAPTOR_LEGACY_UPLOADS_DIR` | No | Overrides the legacy uploads import source (v3→v4 migration) |
| `BOTORAPTOR_DISABLE_DOCKER_DETECT` | No | `1` disables automatic Compose detection for rollback routing |

---

## Deployment & Lifecycle

The repository is an npm workspace (`apps/server`, `apps/web`) and every install,
build, start, update, backup, and rollback operation is driven by the lifecycle
launcher at `tools/botoraptor.mjs`. There is exactly one entry point — the
launcher — for both direct (Node) and Docker deployments. Direct and Docker
modes share the same persistent layout under `data/` and the same `/health`
probe, so moving between modes does not change the data contract.

**The launcher owns process management.** Production servers are started as a
detached child of the launcher, recorded in `data/server.pid`, and logged to
`data/server.log`. PM2 is no longer used; `apps/server/ecosystem.config.cjs`
remains only as a legacy artifact and MUST NOT be used to start the server.

### Prerequisites

| Mode | Requirements |
|------|--------------|
| Direct | Node.js >= 20, npm (workspaces support) |
| Docker | Docker Engine with Compose v2 (`docker compose`) |

### First run — Direct mode

```bash
git clone https://github.com/lirrensi/Botoraptor.git
cd Botoraptor
npm start
```

`npm start` runs the launcher's `start` command, which:

1. Creates `data/config`, `data/db`, `data/uploads`, and `data/backups`.
2. Copies bundled configuration defaults and migrates legacy state (see
   [v4 migration manual](../../private/MIGRATION-v4.md)) — only into absent or
   empty destinations; existing files are never replaced.
3. Generates `data/.env` with a random `FILE_SIGNING_SECRET` when absent.
4. Installs workspace dependencies (`npm install --workspaces`) and builds the
   web UI and server, unless the artifacts already exist.
5. Applies Prisma migrations (see Migration policy below).
6. Writes `data/release.json`, starts the server detached, and verifies
   `GET /health`.

The server listens on port `31000` by default (configured in
`data/config/server.json`).

### First run — Docker mode

```bash
git clone https://github.com/lirrensi/Botoraptor.git
cd Botoraptor
docker compose up -d --build
docker compose ps
```

The image (`apps/server/Dockerfile`) contains its own workspace dependencies
and builds; the launcher inside the image skips install/build
(`BOTORAPTOR_IMAGE=1`). The Compose file bind-mounts the same `./data` used by
direct mode and serves the same `/health` healthcheck. During the first start,
legacy named volumes (`chatlayer_db`, `chatlayer_uploads`) are mounted
read-only and imported once into `data/db` and `data/uploads`.

### Lifecycle commands

All lifecycle commands are run from the repository root.

| Command | Launcher action | Purpose |
|---------|-----------------|---------|
| `npm start` | `start` | Initialize, install/build if needed, migrate, start server |
| `npm run status` | `status` | Report version, health, port, and data locations as JSON |
| `npm run update` | `update` | Stop, backup, install/build, migrate, start, verify `/health` |
| `npm run rollback` | `rollback` | Restore last backup atomically and restart (Docker-aware) |
| `npm run backup` | `backup` | Create a timestamped backup under `data/backups/` |
| `npm run docker:update` | `docker-update` | Quiesce service, backup bind-mounted data, rebuild image, verify `/health` |
| `npm run docker:rollback` | `docker-rollback` | Restore data atomically, restart Compose, verify `/health` |
| `node tools/botoraptor.mjs install` | `install` | Initialize, install, build, migrate (no server start) |
| `node tools/botoraptor.mjs restore-data` | `restore-data` | Restore last backup without restarting (Docker one-shot) |

### Updates

Direct mode:

```bash
git pull
npm run update
```

The update stops the managed process, creates a timestamped backup under
`data/backups/` (kept even after success), rebuilds, applies non-destructive
migrations, starts the new process, and verifies `/health`.

Docker mode:

```bash
git pull
npm run docker:update
```

The Docker update stops the service so SQLite is quiescent, backs up the
bind-mounted `data/` via a container one-shot, rebuilds the image, restarts, and
verifies `/health`. If the backup fails, the previous service is restarted and
the image is not rebuilt.

### Rollback

```bash
npm run rollback          # direct mode
npm run docker:rollback   # docker mode
```

`rollback` restores the persistent state from the last update backup — staging
the replacement state, keeping a safety backup, and swapping atomically — then
restarts. If Compose is active, `npm run rollback` automatically routes to the
container-safe one-shot restore path and never starts a host process. Rollback
restores data only; to roll back application code as well, restore the data,
check out the prior release tag, and bootstrap it (`npm start` direct, or
`docker compose up -d --build` in Docker).

### Migration policy

The launcher prefers `prisma migrate deploy`. `prisma db push` is used only when
Prisma reports P3005 for a non-empty legacy SQLite database that has no Prisma
migration history, and never with `--accept-data-loss`. Any other migration
failure stops without resetting, deleting, or accepting data loss. Restores
preserve records and files at the record level; SQLite byte identity is not
guaranteed after migration.

The production search migration is additive: it creates `MessageTag` and the
message/room/tag/global-option indexes, then backfills the supported legacy JSON
tag shapes using SQLite JSON1 while retaining the source columns. The backfill
and `normalizeTagValues` share support for arrays containing `{tag}`/`{tags}`
objects and metadata envelopes. For the narrowly scoped no-history P3005
reconciliation path, the launcher invokes `scripts/reconcile-message-tags.ts`
once after `db push`; that helper keyset-pages source messages and replaces only
the derived `MessageTag` rows inside one long interactive transaction, so a
failed rebuild cannot expose a partial index and retries are safe. The helper
also accepts an optional `botId` scope for isolated repairs and verification
fixtures; the launcher uses the all-message default. Normal start/update
migrations do not run a tag rebuild.

### Lifecycle serialization

Every lifecycle operation is serialized by `data/.lifecycle.lock`, recording
the owning PID, host, operation, and timestamp. Dead or expired owners
(30 minutes) are recovered as stale. The managed-process record
(`data/server.pid`) also records a host, launch time, and token and is removed
when the process exits, preventing accidental termination of a reused PID.

### Development

The v4 launcher does not change hot-reload development. Inside the workspace:

```bash
npm install --workspaces
cd apps/server
npm run dev          # tsx hot reload, serves API on port 31000
```

For frontend-only development, run `npm run dev` in `apps/web` (Vite dev
server, API proxied via `VITE_API_BASE`). Production builds of both
applications are produced by the launcher during `start`/`install`/`update`,
or manually with `npm run build --workspace=chat_layer_server` and
`npm run build --workspace=chat_layer_web_ui`.

---

## Error Handling

### Error Response Format

```json
{
  "success": false,
  "errorMessage": "Human-readable message",
  "details": { "field": "additional context" }
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created (for message creation) |
| 400 | Bad request (missing/invalid fields) |
| 401 | Unauthorized (missing/invalid API key) |
| 403 | Forbidden (expired signature, invalid key) |
| 404 | Not found |
| 413 | Payload too large (file size exceeded) |
| 500 | Internal server error |

---

## Contracts / Invariants

| Invariant | Description |
|-----------|-------------|
| API key required | All endpoints except `/api/v1/health` and `/api/v1/getClientConfig` MUST require valid API key |
| Message ordering | Messages MUST be returned newest-first |
| User auto-creation | Adding a message MUST create user if not exists |
| Webhook non-blocking | Webhook failures MUST NOT block message creation |
| File access control | Files MUST NOT be accessible without valid signature or API key |
| UUID filenames | Uploaded files MUST use server-generated UUIDs, never user-provided names |
| getRooms paginated | getRooms MUST use pagination, MUST NOT load all messages into memory |
| Batch user fetch | getRooms MUST fetch users in a single query, not per-room |
| Rate limit enforced | All endpoints MUST have rate limiting |
| CORS restricted | CORS MUST NOT allow all origins in production |
| Metadata blocked | uploadFileByURL MUST reject cloud metadata URLs |

---

## Design Decisions

| Decision | Why |
|----------|-----|
| SQLite database | Self-contained, no external DB needed, sufficient for expected scale |
| Long-polling over WebSockets | Simpler, works through proxies, sufficient for chat use case |
| Auto-increment message IDs | Simpler for single-server deployment |
| Signed URLs for files | Stateless auth, no session management needed |
| Prisma ORM | Type-safe, migrations, good DX |

---

## Implementation Pointers

- **Entry point**: `src/index.ts`
- **Routes**: `src/index.ts` (routes defined inline)
- **Message controller**: `src/controllers/messageController.ts`
- **Long-poll manager**: `src/helpers/logpollManager.ts`
- **SSRF validation**: `src/helpers/ssrfProtection.ts`
- **Database schema**: `prisma/schema.prisma`
- **Configuration**: `data/config/server.json`, `data/config/client.json`
