# Botoraptor Server

Express.js + TypeScript server with SQLite, long-polling, webhooks, and file uploads.

Persistent configuration and data are owned by the repository-level `data/` contract.

## Quick Start

From the repository root, use the v4 lifecycle launcher (installs, builds,
migrates, and starts the server):

```bash
npm start
```

The server runs on `http://localhost:31000`. For Docker, `docker compose up -d --build`.
See [docs/core/server.md](../docs/core/server.md) for the full lifecycle
(update, rollback, backup, status) and the [v4 migration manual](../../private/MIGRATION-v4.md).

### Hot-reload development (inside this package)

```bash
npm install          # from the repository root, or: npm install --workspaces
npm run generate     # Generate Prisma client
npm run dev          # tsx hot reload, development only
```

## Common Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start with hot reload |
| `npm run build` | Compile TypeScript |
| `npm run test:dev` | Run tests |
| `npm run db:studio` | Open Prisma Studio |

## Configuration

Edit `../../data/config/server.json`:

```json
{
  "port": 31000,
  "apiKeys": ["your-secret-key"],
  "maxFileSize": 10485760,
  "fileTTLSeconds": 604800
}
```

The launcher stores the signing secret in `../../data/.env`:

```bash
FILE_SIGNING_SECRET=your-secret-key
```

## Documentation

- **Architecture & API**: [docs/core/server.md](../docs/core/server.md)
- **Product Overview**: [docs/overview/product.md](../docs/overview/product.md)
- **Full Doc Index**: [docs/INDEX.md](../docs/INDEX.md)

## Project Structure

```
src/
├── index.ts              # Express app & routes
├── controllers/          # Business logic
└── helpers/              # Long-poll, utilities
```

See [AGENTS.md](AGENTS.md) for coding guidelines.
