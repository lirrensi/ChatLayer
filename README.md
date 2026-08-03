# Botoraptor

**Human-in-the-loop conversation middleware for customer-facing bots.**

Botoraptor gives your bot a human support inbox. It logs every incoming message
from your bots, shows conversations to operators in a manager-facing web UI, lets
them reply from the browser, and delivers those replies back to your system —
without you rebuilding your bot around a new platform.

- Self-hosted, single server, single SQLite database
- Works with any bot or backend that speaks HTTP (Telegram, Discord, WhatsApp,
  Slack, custom apps, Make/n8n automation flows, ...)
- SDKs for Node.js, Python, Go, and PHP
- Formerly known as **ChatLayer** — legacy aliases still work

---

## Why it exists

Most bot frameworks are excellent at the programmatic side — sending and
receiving messages, handling intents, automating flows. But they stop short the
moment you need **real operational visibility**. There is no inbox. There is no
way for a human to step in when automation fails, stalls, or needs a hand.

That gap is what Botoraptor fills:

| Pain point | What Botoraptor does about it |
| --- | --- |
| Your bot has no conversation inbox | All incoming messages are stored in one place, per bot and per room |
| Managers can't step in when automation fails | A manager-facing web UI shows live conversations and lets operators reply |
| Message history scattered across logs and scripts | Everything lives in a queryable SQLite database with a clean API |
| Every bot platform has its own constraints | One middleware layer that every platform speaks to over HTTP |

**The short version:** your bot keeps doing bot things. Botoraptor gives it the
missing interface for human-in-the-loop messaging.

## Who it's for

Developers who already have a bot, automation, or backend flow — but do not have
a good human-facing conversation UI. Especially useful when a manager or
operator needs to:

- see what is happening inside bot conversations in a clear interface
- inspect granular events and message flow instead of guessing from logs
- jump in and send messages back to the user from a proper UI
- keep the existing bot stack instead of rebuilding around a new platform

## How it works

1. **Your bot** sends every incoming message to Botoraptor via the SDK or REST API
2. **Botoraptor** stores the message and serves the manager web UI
3. **Operators** view conversations and send replies from the browser
4. **Your bot** listens for outgoing messages (long-polling or webhook) and
   delivers them to the end user

```text
user <──> your bot <──> Botoraptor (API + UI) <──> human operator
         (owns delivery)       ▲
                              └─ replies come back via webhook / long-polling
```

## Use cases

- **Telegram support bot** — log incoming chats, let managers reply from the web
  UI, deliver replies back through your Telegram bot
- **WhatsApp or Discord bot** — keep your current bot logic, add a real
  operations interface for humans
- **Custom backend bot** — push events from your own server, listen for outbound
  human replies by webhook
- **Automation tools** — connect webhook-friendly tools like Make or n8n and use
  Botoraptor as the human conversation layer

## What's included

| Component | Description |
|-----------|-------------|
| **Server** | Node.js + Express with SQLite database. Handles the API, long-polling, webhooks, and file storage. |
| **Web UI** | Vue 3 + Ionic manager interface for viewing and responding to conversations. |
| **Node SDK** | Single-file TypeScript client (zero dependencies) for Node.js bots and web apps. |
| **Python SDK** | Async Python client for Python bots. |
| **Go SDK** | Thin Go HTTP client for bots and services. |
| **PHP SDK** | Drop-in PHP client for bots and services. |

---

## Quickstart

### Prerequisites

- **Node.js 20+** and npm (workspaces)
- Docker with Compose (optional — only for Docker mode)

### Direct Node mode

```bash
git clone https://github.com/lirrensi/Botoraptor.git
cd Botoraptor
npm start
```

The launcher uses the repository's npm workspaces, creates `data/`, generates
the first file-signing secret, installs/builds both applications, applies Prisma
migrations without a reset, and starts the server at <http://localhost:31000>.

### Docker mode

```bash
git clone https://github.com/lirrensi/Botoraptor.git
cd Botoraptor
docker compose up -d --build
docker compose ps
```

Docker bind-mounts the same `./data` directory used by direct mode. The production
image contains its application dependencies and builds, so startup never installs
into the bind-mounted data directory. Open <http://localhost:31000> after the
health status is `healthy`.

### PM2 mode (process supervision)

Use PM2 when you already run a PM2 fleet and want Botoraptor supervised
alongside your other services. The repo ships a PM2 ecosystem file at
[`apps/server/ecosystem.config.cjs`](apps/server/ecosystem.config.cjs) that runs
the server in production mode from `apps/server` (launched via `node` + the tsx
CLI, resolved like the launcher does — no npm shim layer).

```bash
git clone https://github.com/lirrensi/Botoraptor.git
cd Botoraptor
npm install -g pm2          # or use npx pm2

# One-time setup: data dirs, data/.env secret, dependencies, build, migrations
# (install prepares everything without starting a process)
node tools/botoraptor.mjs install

pm2 start apps/server/ecosystem.config.cjs
pm2 save                    # remember the process list for reboot
```

Open <http://localhost:31000> and confirm `/health` answers. Useful PM2 commands:

```bash
pm2 status                  # process state and restarts
pm2 logs botoraptor         # live output (PM2 logs; data/server.log is launcher-only)
pm2 restart botoraptor      # restart after a config change
```

> **PM2 vs the launcher:** the launcher's `npm start` / `npm run update` /
> `npm run rollback` spawn their own supervised process with PID markers. When
> PM2 owns the process, do **not** mix those commands in — PM2 and the launcher
> would both try to control the port. Under PM2, use `install` for setup and
> migrations, `npm run backup` for snapshots, and `pm2 ...` for process control
> (update and rollback steps below).

---

## Safe updates

After fetching a new release, update direct mode with one command:

```bash
git pull
npm run update
```

The update stops the managed process, backs up persistent state, installs and
builds v4, applies non-destructive migrations, starts the new process, and checks
`/health`. The backup is retained even after a successful update.

For Docker, use the lifecycle command so the bind-mounted data is backed up before
the image is rebuilt:

```bash
git pull
npm run docker:update
```

The Docker update first stops the service so SQLite is quiescent, creates the
backup from the bind mount, rebuilds, restarts, and verifies `/health`. If the
backup fails, the old service is started again and the image is not rebuilt. The
equivalent ordinary first start remains `docker compose up -d --build`.

Inspect or recover a direct deployment:

```bash
npm run status
npm run rollback
```

`rollback` restores the persistent state from the last update backup and restarts
the currently checked-out code. To roll back application code too, check out the
prior release/tag after restoring the data, then rebuild/start that checkout. If Compose is active,
`npm run rollback` automatically uses the container-safe one-shot restore path;
it never starts a host server process. The explicit Docker form is:

```bash
npm run docker:rollback
```

For a complete direct code-and-data rollback, restore the data first, then check
out the prior release and bootstrap it:

```bash
npm run rollback
git checkout <previous-release-tag>
npm install
npm start
```

### Updating under PM2

PM2 owns the process, so update with the launcher's `install` (non-destructive)
instead of `npm run update`:

```bash
git pull
pm2 stop botoraptor                     # quiesce SQLite before migration
npm run backup                          # snapshot of data/ before the update
node tools/botoraptor.mjs install       # deps, build, non-destructive migrations
pm2 restart botoraptor
```

Verify `/health` and the new version in the logs:

```bash
curl http://localhost:31000/health
pm2 logs botoraptor --lines 20
```

### Rolling back under PM2

Restore the data snapshot first, then switch the code. Use `restore-data`
instead of `npm run rollback` — rollback starts its own supervised process,
which would conflict with PM2:

```bash
pm2 stop botoraptor
node tools/botoraptor.mjs restore-data   # restores data from the last backup, no process start
git checkout <previous-release-tag>     # then rebuild/install that checkout
node tools/botoraptor.mjs install
pm2 restart botoraptor
```

If no backup is recorded in `data/release.json`, restore manually from
`data/backups/<timestamp>/` by copying `config`, `db`, `uploads`, and `.env`
back into `data/`, then restart.

### Docker update and rollback

The Docker rollback stages the replacement state, retains a safety backup, starts
Compose, and verifies health. Restore data while this v4 checkout is present,
then switch the code and rebuild the image:

```bash
npm run docker:rollback
docker compose stop botoraptor
git checkout <previous-release-tag>
docker compose up -d --build
docker compose ps
```

---

## Persistent data contract

Only `data/` is mutable application state:

| Path | Contents |
| --- | --- |
| `data/config/server.json` | API port, keys, CORS, and webhook configuration |
| `data/config/client.json` | Manager UI configuration |
| `data/db/botoraptor.db` | SQLite database and Prisma state |
| `data/uploads/` | Uploaded files |
| `data/.env` | Runtime secret and operator environment values |
| `data/backups/` | Timestamped update/rollback backups |
| `data/release.json` | Current release and rollback marker |
| `data/server.log` | Managed direct-mode server output |

The launcher never replaces non-empty config, database, upload, or environment
files. During a migration it copies legacy content only when the corresponding v4
destination is absent or empty. Docker mounts legacy named volumes read-only for
the same one-time import. See the standalone [v4 migration manual](private/MIGRATION-v4.md)
for historical source locations and verification steps.

Every install, update, backup, restore, migration, build, and health transition is
serialized by `data/.lifecycle.lock`. The marker records the owner PID, host,
operation, and timestamp; dead or expired owners are recovered as stale. Managed
server PID markers also record a host, launch time, and token and are removed when
the process is gone, reducing accidental termination of a reused PID.

Prisma migrations are preferred. `db push` is used only when Prisma reports P3005
for a non-empty legacy SQLite database that has no Prisma migration history. Any
other migration failure stops without resetting, deleting, or accepting data loss.
Restores preserve records and files at the record level; SQLite may have different
file bytes after a migration or restore even when the records are unchanged.

---

## Integrating your bot

### Node.js SDK example

The Node SDK is a single self-contained file — copy
[`sdk-templates/node/botoraptor.ts`](sdk-templates/node/botoraptor.ts) into your
project (or import it in place), then:

```typescript
import Botoraptor from "./botoraptor";

const botoraptor = new Botoraptor({
  apiKey: "your-api-key",
  baseUrl: "http://localhost:31000",
  botIds: ["my-bot"],
  listenerType: "bot", // 'bot' for bots, 'ui' for web apps
});

// Send incoming messages to Botoraptor
async function onUserMessage(msg) {
  await botoraptor.addMessage({
    botId: "my-bot",
    roomId: msg.chatId,
    userId: msg.userId,
    text: msg.text,
    messageType: "user_message",
  });
}

// Listen for manager messages
botoraptor.onMessage((msg) => {
  // Deliver to your platform
  sendMessageToUser(msg.roomId, msg.text);
});

botoraptor.start();
```

Per-language references: [Node](docs/nsdks/node.md) ·
[Python](docs/nsdks/python.md) · [Go](docs/nsdks/go.md) ·
[PHP](docs/nsdks/php.md).

### Message types

| Type | Description |
|------|-------------|
| `user_message` | User typed a message to the bot |
| `user_message_service` | User interaction with bot features (button clicks, etc.) |
| `bot_message_service` | Automated bot response |
| `manager_message` | Message from a human operator |
| `service_call` | Special event requesting human takeover |
| `error_message` | System error or failure notification |
| `event` | Event-driven notification or system event |

Messages also accept an optional `tags` (string array) field for arbitrary
classification and filtering.

---

## Configuration and API

Set API keys in `data/config/server.json` after first start. Existing endpoint
paths and response behavior remain intact. The API documentation is available at
`/api-docs` (OpenAPI JSON at `/api/v1/openapi.json`), and the health probe is
`/health` or `/api/v1/health`.

### Authentication

All endpoints except `/api/v1/health` and `/api/v1/getClientConfig` require an
API key. Send it as `Authorization: Bearer <api-key>`, the `x-api-key` header, or
the `api_key` query parameter. The Web UI has a dedicated auth page (`/auth`) that
validates keys before any route loads.

### Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/health` | Server status probe (no auth) |
| `GET` | `/api/v1/getClientConfig` | Client-side configuration (no auth) |
| `POST` | `/api/v1/addMessage` | Send a message |
| `POST` | `/api/v1/addMessageSingle` | Send a message with a file (multipart) |
| `GET` | `/api/v1/getMessages` | Fetch messages with cursor pagination and type filters |
| `GET` | `/api/v1/getUpdates` | Long-polling for real-time updates |
| `GET` | `/api/v1/getBots` | List bot IDs |
| `GET` | `/api/v1/getFilterOptions` | Distinct message types and normalized tags |
| `GET` | `/api/v1/getRooms` | Room/conversation list with filters (incl. `tags`) |
| `POST` | `/api/v1/addUser` | Create or retrieve a user |
| `POST` | `/api/v1/uploadFile` | Upload a file (browser or Node) |
| `POST` | `/api/v1/uploadFileByURL` | Upload a file from a remote URL |
| `GET` | `/apiKeyCheck` | Validate an API key |

Outbound replies are delivered to your bot via long-polling (`getUpdates`) or
configurable webhooks with retry logic.

### Security

- **API key authentication** on every endpoint except health and client config
- **Rate limiting** on all endpoints
- **SSRF protection** on `uploadFileByURL` — blocks cloud metadata endpoints
  (AWS/GCP/Azure/Alibaba) and validates URLs before fetching
- **Security headers** via Helmet, configurable **CORS** origins for cross-origin
  Web UI deployments
- **Signed file URLs**, filename sanitization, and dangerous-file warnings in the UI
- **Non-destructive lifecycle** — migrations, updates, and rollbacks never
  reset or delete persistent state

---

## Repository map

```text
apps/server/       Express API, Prisma schema, and server build
apps/web/          Vue/Ionic manager UI
sdk-templates/     Copyable node, python, go, and php SDK source templates
data/              Persistent state (created/populated at runtime)
docs/              Canonical product and architecture documentation
tools/             Lifecycle launcher and operational tooling
```

SDK templates are source to copy into an integration; they are not workspace
packages. Go and PHP do not have a normal package-version field, so their v4
release is identified by this repository release and the SDK documentation.

### Note on the ChatLayer rename

`Botoraptor` is the new product name for what was previously called `ChatLayer`.
New docs, UI text, and examples use `Botoraptor`; legacy `ChatLayer` imports,
SDK exports, UI storage keys, and Docker volume names still work as compatibility
aliases so existing integrations do not break.

---

## Documentation

- [Documentation index](docs/INDEX.md)
- [Product overview](docs/overview/product.md) — concepts, data model, non-goals
- [Server architecture and API](docs/core/server.md)
- [Web UI architecture](docs/core/web-ui.md)
- SDK references: [Node](docs/nsdks/node.md) · [Python](docs/nsdks/python.md) ·
  [Go](docs/nsdks/go.md) · [PHP](docs/nsdks/php.md)
- [v4 migration manual](private/MIGRATION-v4.md) — v3 → v4 procedure
- [Changelog](CHANGELOG.md)

## License

MIT — see [LICENSE](LICENSE).
