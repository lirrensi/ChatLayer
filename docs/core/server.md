---
node_type: architecture
title: Server Architecture & API Reference
status: active
updated: 2026-07-16
tags: [server, architecture, api, typescript]
links:
  depends_on: [/overview/product.md]
  documents: [/server/src/]
  relates_to: [/core/web-ui.md, /nsdks/node.md, /nsdks/python.md, /nsdks/go.md, /nsdks/php.md]
---

# Server Architecture & API Reference

Backend API for Botoraptor — Express.js + TypeScript + SQLite.

---

## Overview

The server is a self-contained REST API that handles message storage, real-time updates via long-polling, webhook dispatch, and file uploads. It serves the Web UI as static files.

Public branding uses `Botoraptor`; some internal paths and compatibility aliases still retain `ChatLayer` naming during the transition.

**Scope Boundary:**

- **This component owns**: HTTP routing, message CRUD, long-polling connections, webhook dispatch, file storage, database operations
- **This component does NOT own**: Bot logic, message delivery to end users, UI rendering
- **Boundary interfaces**: Receives messages from SDKs, serves UI to browsers, dispatches webhooks to external services

---

## Project Structure

```
server/
├── src/
│   ├── index.ts              # Express app, routes, middleware
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
│   ├── server.json           # Server configuration
│   └── client.json           # Client configuration
├── public/
│   ├── uploads/              # File storage
│   └── index.html            # Web UI (built)
├── db/
│   ├── dev.db                # Development database
│   └── main.db               # Production database
├── package.json
├── tsconfig.json
└── ecosystem.config.cjs      # PM2 configuration
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
  createdAt   DateTime @default(now())

  user User @relation("UserMessages", fields: [userId, botId], references: [userId, botId])

  @@index([botId, roomId])
  @@index([botId, userId])
  @@index([createdAt])
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
| Room | `botId, roomId` | Fetch messages by room |
| User | `botId, userId` | Filter messages by user within a bot |
| Created | `createdAt` | Efficient time-ordered queries |

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
GET /api/v1/health
```

No authentication required. Returns server status.

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
- `cursorId` (string, optional) — Pagination cursor (message ID)
- `types` (string, optional) — Comma-separated message types to filter
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

#### Get Rooms

```
GET /api/v1/getRooms
```

Get room information with pagination.

**Query Parameters:**
- `botId` (string, required) — Bot identifier
- `messageType` (string, optional) — Filter rooms by recent message type
- `depth` (number, default: 10) — Number of recent messages to check per room
- `limit` (number, default: 50, max: 500) — Max rooms to return
- `cursorId` (string, optional) — Pagination cursor (room ID)

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
- Messages are not fully loaded into memory
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

Webhooks are configured in `config/server.json`:

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

Files are stored in `public/uploads/` with UUID filenames.

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
- Keys SHOULD be loaded from environment variables (`API_KEYS` comma-separated)
- Config file storage is for development only
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

CORS MUST be configured via `corsOrigins` in `config/server.json`:

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

### Server Configuration (`config/server.json`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | number | 31000 | Server port |
| `apiKeys` | string[] | — | Valid API keys |
| `corsOrigins` | string[] | [] | Allowed CORS origins (empty = CORS disabled) |
| `maxFileSize` | number | 10485760 | Max upload size in bytes (10MB) |
| `fileTTLSeconds` | number | 604800 | File lifetime in seconds (7 days) |
| `webhooks` | array | [] | Webhook configurations |

### Client Configuration (`config/client.json`)

| Field | Type | Description |
|-------|------|-------------|
| `quickAnswersPreset` | string[] | Pre-defined quick reply messages for managers |
| `dangerousExtensions` | string[] | File extensions flagged as potentially dangerous |

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FILE_SIGNING_SECRET` | Yes | HMAC secret for file URLs |
| `DATABASE_URL_PROD` | No | Production database path (defaults to `file:./db/main.db`) |
| `DATABASE_URL_DEV` | No | Development database path (defaults to `file:./db/dev.db`) |
| `NODE_ENV` | No | Set to `production` for production mode |
| `API_KEYS` | No | Comma-separated API keys (alternative to config file) |

---

## Deployment

### Development

```bash
cd server
pnpm install
pnpm run generate    # Generate Prisma client
pnpm run db:push     # Initialize database
pnpm run dev         # Start with hot reload
```

### Production

```bash
pnpm run build       # Compile TypeScript
NODE_ENV=production pnpm run migrate:prod
pm2 start ecosystem.config.cjs
```

### Docker

```bash
docker-compose up -d
```

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
- **Configuration**: `config/server.json`, `config/client.json`
