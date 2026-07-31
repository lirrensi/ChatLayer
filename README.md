# Botoraptor v4

Botoraptor is a self-hosted human-in-the-loop conversation API and manager UI. The
server continues to expose the existing API; v4 reorganizes the repository and
makes application state portable and safe to update.

## Start from a fresh clone

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

The rollback stages the replacement state, retains a safety backup, starts
Compose, and verifies health. For a complete direct code-and-data rollback,
restore the data first, then check out the prior release and bootstrap it:

```bash
npm run rollback
git checkout <previous-release-tag>
npm install
npm start
```

For Docker, restore data while this v4 checkout is present, then switch the code
and rebuild the image:

```bash
npm run docker:rollback
docker compose stop botoraptor
git checkout <previous-release-tag>
docker compose up -d --build
docker compose ps
```

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

## Configuration and API

Set API keys in `data/config/server.json` after first start. Existing endpoint
paths and response behavior remain intact; v4 does not invent a new API URL
version. The API documentation is available at `/api-docs`, and the health probe
is `/health` or `/api/v1/health`.

## Documentation

- [Migration manual](private/MIGRATION-v4.md)
- [Changelog](CHANGELOG.md)
- [Documentation index](docs/INDEX.md)
- [Product overview](docs/overview/product.md)
- [Server architecture and API](docs/core/server.md)
- [Web UI architecture](docs/core/web-ui.md)

## License

See [LICENSE](LICENSE).
