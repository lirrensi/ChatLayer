// FILE: tools/botoraptor.mjs
// PURPOSE: Provide the cross-platform first-run, update, backup, health, and rollback lifecycle for Botoraptor.
// OWNS: Persistent data initialization, lifecycle locking, legacy migration, release markers, process control, and Docker helpers.
// EXPORTS: CLI commands start, install, update, status, rollback, backup, and docker-update.
// DOCS: README.md, MIGRATION-v4.md, docs/core/server.md

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = path.resolve(process.env.BOTORAPTOR_DATA_DIR ?? path.join(root, "data"));
const config = path.join(data, "config");
const db = path.join(data, "db");
const uploads = path.join(data, "uploads");
const backups = path.join(data, "backups");
const markerFile = path.join(data, "release.json");
const pidFile = path.join(data, "server.pid");
const lifecycleLockFile = path.join(data, ".lifecycle.lock");
const serverPackage = path.join(root, "apps", "server");
const webPackage = path.join(root, "apps", "web");
const serverEntry = path.join(serverPackage, "dist", "index.js");
const serverRunner = path.join(serverPackage, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
const rootPackage = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const releaseVersion = rootPackage.version;
const hostName = os.hostname();
const lifecycleLockMaxAgeMs = 30 * 60 * 1000;
const requireFromLauncher = createRequire(import.meta.url);

function isDockerMode() {
    return process.env.BOTORAPTOR_DOCKER_MODE === "1" || fs.existsSync("/.dockerenv");
}

function log(message) {
    console.log(`[Botoraptor] ${message}`);
}

function fail(message) {
    console.error(`[Botoraptor] ERROR: ${message}`);
    process.exitCode = 1;
}

function existsDirectory(directory) {
    return typeof directory === "string" && fs.existsSync(directory) && fs.statSync(directory).isDirectory();
}

function isEmpty(directory) {
    return !fs.existsSync(directory) || (existsDirectory(directory) && fs.readdirSync(directory).length === 0);
}

function ensureDirectories() {
    for (const directory of [data, config, db, uploads, backups]) {
        fs.mkdirSync(directory, { recursive: true });
    }
}

function copyFileIfMissing(source, destination) {
    if (!fs.existsSync(source) || (fs.existsSync(destination) && fs.statSync(destination).size > 0)) return false;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    log(`Copied legacy file ${path.relative(root, source)} -> ${path.relative(root, destination)}`);
    return true;
}

function copyDirectoryIfEmpty(source, destination) {
    if (!existsDirectory(source) || !isEmpty(destination)) return false;
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        fs.cpSync(path.join(source, entry.name), path.join(destination, entry.name), { recursive: true });
    }
    log(`Copied legacy directory ${path.relative(root, source)} -> ${path.relative(root, destination)}`);
    return true;
}

function legacyCandidates(relativePaths, environmentKey) {
    const explicit = process.env[environmentKey];
    return [
        ...(explicit ? [path.resolve(explicit)] : []),
        ...relativePaths.map(relativePath => path.join(root, relativePath)),
    ];
}

function migrateLegacyData() {
    const bundledConfig = path.join(root, "apps", "server", "config");
    for (const fileName of ["server.json", "client.json"]) {
        const destination = path.join(config, fileName);
        const sources = [
            ...legacyCandidates([path.join("server", "config", fileName)], "BOTORAPTOR_LEGACY_CONFIG_DIR")
                .map(directory => path.join(directory, fileName)),
            path.join(bundledConfig, fileName),
        ];
        for (const source of sources) {
            if (copyFileIfMissing(source, destination)) break;
        }
    }

    const envDestination = path.join(data, ".env");
    if (!fs.existsSync(envDestination) || fs.statSync(envDestination).size === 0) {
        for (const source of [path.join(root, ".env"), path.join(root, "server", ".env")]) {
            if (copyFileIfMissing(source, envDestination)) break;
        }
    }
    let envText = fs.existsSync(envDestination) ? fs.readFileSync(envDestination, "utf8") : "";
    if (!/^\s*FILE_SIGNING_SECRET\s*=/m.test(envText)) {
        const secret = crypto.randomBytes(32).toString("hex");
        envText = `${envText.trimEnd()}\nFILE_SIGNING_SECRET=${secret}\n`;
        fs.writeFileSync(envDestination, envText, { mode: 0o600 });
        log("Created data/.env with a generated FILE_SIGNING_SECRET");
    }

    if (isEmpty(db)) {
        const databaseSources = legacyCandidates(
            [path.join("private", "production.db"), path.join("server", "db")],
            "BOTORAPTOR_LEGACY_DB_DIR",
        );
        const files = [];
        for (const candidate of databaseSources) {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) files.push(candidate);
            if (existsDirectory(candidate)) {
                for (const entry of fs.readdirSync(candidate)) {
                    if (/\.(db|sqlite|sqlite3)$/i.test(entry)) files.push(path.join(candidate, entry));
                }
            }
        }
        const preferred = files.find(file => /production|main|botoraptor/i.test(path.basename(file))) ?? files[0];
        if (preferred) copyFileIfMissing(preferred, path.join(db, "botoraptor.db"));
    }

    copyDirectoryIfEmpty(
        legacyCandidates([path.join("server", "public", "uploads")], "BOTORAPTOR_LEGACY_UPLOADS_DIR").find(
            directory => existsDirectory(directory) && !isEmpty(directory),
        ),
        uploads,
    );
}

function initializeData() {
    ensureDirectories();
    migrateLegacyData();
}

function lockRecordIsStale(record) {
    if (!record || typeof record !== "object") return true;
    const startedAt = Date.parse(record.startedAt);
    if (!Number.isFinite(startedAt) || Date.now() - startedAt > lifecycleLockMaxAgeMs) return true;
    if (record.host === hostName && (!Number.isInteger(record.pid) || !processIsAlive(record.pid))) return true;
    return false;
}

function processIsAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function readJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
        return null;
    }
}

function acquireLifecycleLock(operation) {
    ensureDirectories();
    const token = crypto.randomUUID();
    const record = { operation, pid: process.pid, host: hostName, startedAt: new Date().toISOString(), token };
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const descriptor = fs.openSync(lifecycleLockFile, "wx", 0o600);
            fs.writeFileSync(descriptor, `${JSON.stringify(record, null, 2)}\n`);
            fs.closeSync(descriptor);
            return record;
        } catch (error) {
            if (error?.code !== "EEXIST") throw error;
            const existing = readJson(lifecycleLockFile);
            if (!lockRecordIsStale(existing)) {
                throw new Error(
                    `Lifecycle operation '${existing?.operation ?? "unknown"}' is already running ` +
                    `(pid ${existing?.pid ?? "unknown"} on ${existing?.host ?? "unknown"}, started ${existing?.startedAt ?? "unknown"}).`,
                );
            }
            fs.rmSync(lifecycleLockFile, { force: true });
            log("Removed a stale lifecycle lock before continuing.");
        }
    }
    throw new Error("Could not acquire the lifecycle lock after stale-lock recovery.");
}

function releaseLifecycleLock(record) {
    const current = readJson(lifecycleLockFile);
    if (current?.token === record.token) fs.rmSync(lifecycleLockFile, { force: true });
}

async function withLifecycleLock(operation, callback) {
    if (process.env.BOTORAPTOR_LIFECYCLE_LOCK_HELD === "1") return callback();
    const record = acquireLifecycleLock(operation);
    try {
        return await callback();
    } finally {
        releaseLifecycleLock(record);
    }
}

function commandName() {
    return process.platform === "win32" ? "corepack.cmd" : "corepack";
}

function runPnpm(args, cwd = root, allowFailure = false) {
    const result = spawnSync(commandName(), ["pnpm", ...args], {
        cwd,
        env: {
            ...process.env,
            COREPACK_ENABLE_PROJECT_SPEC: "1",
            BOTORAPTOR_SKIP_INSTALL_LIFECYCLE: "1",
        },
        stdio: "inherit",
        shell: process.platform === "win32",
    });
    if (result.error || result.status !== 0) {
        if (allowFailure) return false;
        throw result.error ?? new Error(`pnpm ${args.join(" ")} failed with exit code ${result.status}`);
    }
    return true;
}

function runPnpmCapture(args, cwd = root) {
    const result = spawnSync(commandName(), ["pnpm", ...args], {
        cwd,
        env: {
            ...process.env,
            COREPACK_ENABLE_PROJECT_SPEC: "1",
            BOTORAPTOR_SKIP_INSTALL_LIFECYCLE: "1",
        },
        encoding: "utf8",
        shell: process.platform === "win32",
        stdio: ["ignore", "pipe", "pipe"],
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (output.trim()) process.stdout.write(output);
    return { ...result, output };
}

function imageRuntime() {
    return process.env.BOTORAPTOR_IMAGE === "1" || process.env.BOTORAPTOR_CONTAINER_IMAGE === "1";
}

function installDependencies(force = false) {
    if (imageRuntime()) {
        log("Using dependencies copied into the production image; install skipped.");
        return;
    }
    if (!force && fs.existsSync(path.join(serverPackage, "node_modules")) && fs.existsSync(path.join(webPackage, "node_modules"))) {
        return;
    }
    log("Installing server and web dependencies with the pinned Corepack pnpm");
    runPnpm(["install", "--frozen-lockfile"], root);
}

function buildApplications(force = false) {
    if (imageRuntime()) {
        log("Using application files copied into the production image; build skipped.");
        return;
    }
    if (force || !fs.existsSync(path.join(webPackage, "dist", "index.html"))) {
        log("Building web application");
        runPnpm(["run", "build"], webPackage);
    }
    if (force || !fs.existsSync(serverEntry)) {
        log("Generating Prisma client and building server");
        runPnpm(["run", "generate"], serverPackage);
        runPnpm(["run", "build"], serverPackage);
    }
}

function databaseHasMigrationHistory() {
    const databaseFile = path.join(db, "botoraptor.db");
    if (!fs.existsSync(databaseFile) || fs.statSync(databaseFile).size === 0) return Promise.resolve(false);
    let sqlite3;
    try {
        sqlite3 = requireFromLauncher(path.join(serverPackage, "node_modules", "sqlite3"));
        sqlite3 = sqlite3.verbose ? sqlite3.verbose() : sqlite3;
    } catch {
        return Promise.resolve(false);
    }
    return new Promise(resolve => {
        const connection = new sqlite3.Database(databaseFile, sqlite3.OPEN_READONLY, error => {
            if (error) {
                resolve(false);
                return;
            }
            connection.get(
                "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = '_prisma_migrations'",
                (tableError, row) => {
                    if (tableError || Number(row?.count) !== 1) {
                        connection.close(() => resolve(false));
                        return;
                    }
                    connection.get("SELECT COUNT(*) AS count FROM _prisma_migrations", (historyError, historyRow) => {
                        connection.close(() => resolve(!historyError && Number(historyRow?.count) > 0));
                    });
                },
            );
        });
        connection.on("error", () => resolve(false));
    });
}

async function migrateDatabase() {
    log("Applying non-destructive Prisma migrations");
    const migration = runPnpmCapture(["run", "migrate:prod"], serverPackage);
    if (migration.status === 0) return;

    const databaseFile = path.join(db, "botoraptor.db");
    const isLegacyDatabase = fs.existsSync(databaseFile) && fs.statSync(databaseFile).size > 0;
    const isP3005 = /P3005\b/i.test(migration.output);
    const hasHistory = isLegacyDatabase ? await databaseHasMigrationHistory() : false;
    if (!isLegacyDatabase || !isP3005 || hasHistory) {
        throw new Error(
            "Prisma migration failed. Only a detected legacy database with P3005 and no migration history may use db push; data was not reset or accepted with data loss.",
        );
    }

    log("Detected a legacy SQLite database without Prisma migration history; reconciling with non-destructive db push.");
    const fallback = runPnpmCapture(["exec", "prisma", "db", "push", "--skip-generate"], serverPackage);
    if (fallback.status !== 0) {
        throw new Error("Legacy database reconciliation failed. No reset or --accept-data-loss operation was attempted.");
    }
}

function readMarker() {
    return readJson(markerFile) ?? {};
}

function writeMarker(values) {
    const temporary = `${markerFile}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(values, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, markerFile);
}

function createBackupUnlocked(reason = "manual") {
    initializeData();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const destination = path.join(backups, `${stamp}-${reason}-${crypto.randomUUID().slice(0, 8)}`);
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of ["config", "db", "uploads", ".env", "release.json"]) {
        const source = path.join(data, entry);
        if (fs.existsSync(source)) fs.cpSync(source, path.join(destination, entry), { recursive: true });
    }
    const manifest = { version: readMarker().version ?? "unknown", createdAt: new Date().toISOString(), reason };
    fs.writeFileSync(path.join(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    log(`Backup created at ${path.relative(root, destination)}`);
    return destination;
}

function serverEnvironment() {
    return {
        ...process.env,
        NODE_ENV: "production",
        BOTORAPTOR_ROOT: root,
        BOTORAPTOR_DATA_DIR: data,
        WEB_DIST_DIR: path.join(webPackage, "dist"),
    };
}

function readPort() {
    try {
        return Number(JSON.parse(fs.readFileSync(path.join(config, "server.json"), "utf8")).port) || 31000;
    } catch {
        return 31000;
    }
}

function checkHealth() {
    return new Promise(resolve => {
        const port = readPort();
        const request = http.get({ hostname: "127.0.0.1", port, path: "/health", timeout: 2500 }, response => {
            response.resume();
            resolve(response.statusCode === 200);
        });
        request.on("error", () => resolve(false));
        request.on("timeout", () => {
            request.destroy();
            resolve(false);
        });
    });
}

async function waitForHealth(timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await checkHealth()) return true;
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    return false;
}

function readPidRecord() {
    if (!fs.existsSync(pidFile)) return null;
    const value = readJson(pidFile);
    if (value && typeof value === "object") return value;
    const legacyPid = Number(fs.readFileSync(pidFile, "utf8"));
    return Number.isInteger(legacyPid) ? { pid: legacyPid, host: hostName, startedAt: "1970-01-01T00:00:00.000Z" } : null;
}

function processCommandMatches(pid) {
    if (process.platform === "linux") {
        try {
            const commandLine = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ");
            return commandLine.includes("apps/server/dist/index.js") || commandLine.includes("server/dist/index.js");
        } catch {
            return false;
        }
    }
    if (process.platform === "darwin") {
        const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        });
        return result.status === 0
            && /apps[\\/]server[\\/]dist[\\/]index\.js|server[\\/]dist[\\/]index\.js/i.test(result.stdout ?? "");
    }
    if (process.platform === "win32") {
        const result = spawnSync("wmic", ["process", "where", `(ProcessId=${pid})`, "get", "CommandLine", "/value"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            windowsHide: true,
        });
        if (result.status === 0 && result.stdout) {
            return /apps[\\/]server[\\/]dist[\\/]index\.js|server[\\/]dist[\\/]index\.js/i.test(result.stdout);
        }
        return true;
    }
    return true;
}

function pidRecordIsManaged(record) {
    if (!record || record.host !== hostName || !processIsAlive(record.pid)) return false;
    return processCommandMatches(record.pid);
}

function pidIsAlive() {
    const record = readPidRecord();
    if (!pidRecordIsManaged(record)) {
        if (record?.host === hostName || !record) fs.rmSync(pidFile, { force: true });
        return false;
    }
    return true;
}

function terminatePid(pid) {
    if (process.platform === "win32") {
        spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", shell: false });
        return;
    }
    process.kill(pid);
}

function removePidFile(token = null) {
    const current = readPidRecord();
    if (!token || current?.launchToken === token) fs.rmSync(pidFile, { force: true });
}

function stopManagedServer() {
    const record = readPidRecord();
    if (!record) return;
    if (pidRecordIsManaged(record)) {
        try {
            terminatePid(record.pid);
            log(`Stopped managed server process ${record.pid}`);
        } catch (error) {
            log(`Could not stop process ${record.pid}: ${String(error)}`);
        }
    }
    removePidFile(record.launchToken ?? null);
}

function markRunning(backup = null) {
    const previous = readMarker();
    writeMarker({
        version: releaseVersion,
        previousVersion: previous.version ?? null,
        updatedAt: new Date().toISOString(),
        backup: backup ?? previous.backup ?? null,
        safetyBackup: previous.safetyBackup ?? null,
        node: process.version,
        platform: os.platform(),
    });
}

function startProcess(detached) {
    const logFile = fs.openSync(path.join(data, "server.log"), "a");
    const child = spawn(serverRunner, [serverEntry], {
        cwd: root,
        env: serverEnvironment(),
        detached,
        stdio: detached ? ["ignore", logFile, logFile] : ["ignore", "inherit", "inherit"],
        shell: process.platform === "win32",
    });
    const launchToken = crypto.randomUUID();
    fs.writeFileSync(
        pidFile,
        `${JSON.stringify({ pid: child.pid, host: hostName, startedAt: new Date().toISOString(), launchToken }, null, 2)}\n`,
        { mode: 0o600 },
    );
    const cleanup = () => removePidFile(launchToken);
    child.once("exit", cleanup);
    child.once("error", cleanup);
    if (detached) child.unref();
    return { child, launchToken };
}

async function startUnlocked({ detached = false, forceBuild = false, backup = null } = {}) {
    initializeData();
    if (pidIsAlive()) throw new Error("A Botoraptor process is already recorded as running; use status first.");
    if (await checkHealth()) throw new Error(`Port ${readPort()} is already serving another process; stop it before starting v4.`);
    installDependencies(forceBuild);
    buildApplications(forceBuild);
    await migrateDatabase();
    markRunning(backup);
    const { child, launchToken } = startProcess(detached);
    if (detached) {
        if (!(await waitForHealth())) {
            try { terminatePid(child.pid); } catch { /* process may already have exited */ }
            removePidFile(launchToken);
            throw new Error("Server failed its health check; inspect data/server.log and use rollback if required.");
        }
        log(`Server v${releaseVersion} is healthy on port ${readPort()}`);
        return;
    }
    child.on("exit", () => removePidFile(launchToken));
}

async function updateUnlocked() {
    initializeData();
    stopManagedServer();
    let backup = null;
    try {
        backup = createBackupUnlocked("update");
        await startUnlocked({ detached: true, forceBuild: true, backup });
        log("Update completed; the backup is the rollback point.");
    } catch (error) {
        if (backup === null) {
            try { await startUnlocked({ detached: true, forceBuild: false }); } catch (restartError) {
                log(`The previous server could not be restarted after backup failure: ${String(restartError)}`);
            }
        }
        console.error(`[Botoraptor] Update failed${backup ? ` after backup ${backup}` : " before backup completed"}: ${String(error)}`);
        console.error("Run `npm run rollback` after reviewing data/server.log.");
        throw error;
    }
}

function readBackupManifest(backup) {
    const manifestPath = path.join(backup, "manifest.json");
    return fs.existsSync(manifestPath) ? readJson(manifestPath) ?? {} : {};
}

function restoreBackupUnlocked(backup) {
    if (!backup || !existsDirectory(backup)) throw new Error("No valid rollback backup is recorded in data/release.json");
    const safety = createBackupUnlocked("before-rollback");
    const stage = path.join(data, `.restore-staging-${crypto.randomUUID()}`);
    const entries = ["config", "db", "uploads", ".env"];
    const installed = [];
    const movedOld = [];
    fs.mkdirSync(stage, { recursive: true });
    try {
        for (const entry of entries) {
            const source = path.join(backup, entry);
            if (fs.existsSync(source)) fs.cpSync(source, path.join(stage, entry), { recursive: true });
        }
        for (const entry of entries) {
            const destination = path.join(data, entry);
            const staged = path.join(stage, entry);
            const old = path.join(stage, `.old-${entry}`);
            if (fs.existsSync(destination)) {
                fs.renameSync(destination, old);
                movedOld.push({ destination, old });
            }
            if (fs.existsSync(staged)) {
                fs.renameSync(staged, destination);
                installed.push(destination);
            }
        }
    } catch (error) {
        for (const destination of installed.reverse()) fs.rmSync(destination, { recursive: true, force: true });
        for (const { destination, old } of movedOld.reverse()) {
            if (fs.existsSync(old)) fs.renameSync(old, destination);
        }
        throw new Error(`Rollback restore was not committed: ${String(error)}`);
    } finally {
        fs.rmSync(stage, { recursive: true, force: true });
    }
    const manifest = readBackupManifest(backup);
    writeMarker({
        version: manifest.version ?? "unknown",
        rolledBackAt: new Date().toISOString(),
        backup,
        safetyBackup: safety,
    });
    log(`Persistent state restored atomically from ${path.relative(root, backup)}; safety backup: ${path.relative(root, safety)}`);
    return backup;
}

async function rollbackDirectUnlocked() {
    initializeData();
    stopManagedServer();
    const backup = restoreBackupUnlocked(readMarker().backup);
    await startUnlocked({ detached: true, forceBuild: false, backup });
    log("Rollback completed. To restore application code too, check out the prior release before running rollback.");
}

function dockerCommand() {
    return process.platform === "win32" ? "docker.exe" : "docker";
}

function runDocker(args, allowFailure = false, environment = {}) {
    const result = spawnSync(dockerCommand(), args, {
        cwd: root,
        env: { ...process.env, ...environment },
        stdio: "inherit",
        shell: process.platform === "win32",
    });
    if (result.error || result.status !== 0) {
        if (allowFailure) return false;
        throw result.error ?? new Error(`docker ${args.join(" ")} failed with exit code ${result.status}`);
    }
    return true;
}

function dockerComposeIsActive() {
    if (process.env.BOTORAPTOR_DISABLE_DOCKER_DETECT === "1" || process.env.BOTORAPTOR_DOCKER_MODE === "1") return false;
    const result = spawnSync(dockerCommand(), ["compose", "ps", "--status", "running", "--services"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        shell: process.platform === "win32",
    });
    return result.status === 0 && String(result.stdout ?? "").split(/\r?\n/).some(line => line.trim() === "botoraptor");
}

function dockerComposeDeploymentExists() {
    if (process.env.BOTORAPTOR_DISABLE_DOCKER_DETECT === "1" || process.env.BOTORAPTOR_DOCKER_MODE === "1") return false;
    const result = spawnSync(dockerCommand(), ["compose", "ps", "-a", "--services"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        shell: process.platform === "win32",
    });
    return result.status === 0 && String(result.stdout ?? "").split(/\r?\n/).some(line => line.trim() === "botoraptor");
}

function oneShotArgs(command) {
    return [
        "compose", "run", "--rm", "--no-deps",
        "-e", "BOTORAPTOR_DOCKER_MODE=1",
        "-e", "BOTORAPTOR_LIFECYCLE_LOCK_HELD=1",
        "botoraptor", "node", "/app/tools/botoraptor.mjs", command,
    ];
}

async function restartDockerService() {
    runDocker(["compose", "start", "botoraptor"], true);
    if (await waitForHealth(15000)) return true;
    if (!runDocker(["compose", "up", "-d", "--no-build", "botoraptor"], true, { BOTORAPTOR_LIFECYCLE_LOCK_HELD: "1" })) {
        return false;
    }
    return waitForHealth(30000);
}

async function dockerUpdateUnlocked() {
    if (!runDocker(["compose", "stop", "--timeout", "30", "botoraptor"], true)) {
        throw new Error("Docker service could not be stopped; SQLite was not copied and no image update was attempted.");
    }
    try {
        if (!runDocker(oneShotArgs("backup"), true)) throw new Error("Docker backup failed.");
    } catch (error) {
        await restartDockerService();
        throw new Error(`${String(error)} The previous Docker service was restarted.`);
    }
    if (!runDocker(["compose", "up", "-d", "--build", "botoraptor"], true, { BOTORAPTOR_LIFECYCLE_LOCK_HELD: "1" })) {
        await restartDockerService();
        throw new Error("Docker update failed after backup; the previous service was restarted where possible.");
    }
    if (!(await waitForHealth(60000))) throw new Error("Docker update did not pass the /health check.");
    log("Docker update completed after quiescing the service, backing up data, rebuilding, and checking health.");
}

async function dockerRollbackUnlocked() {
    if (!runDocker(["compose", "stop", "--timeout", "30", "botoraptor"], true)) {
        throw new Error("Docker service could not be stopped; rollback was not attempted.");
    }
    if (!runDocker(oneShotArgs("restore-data"), true)) {
        await restartDockerService();
        throw new Error("Docker rollback restore failed; the previous service was restarted where possible.");
    }
    if (!runDocker(["compose", "up", "-d", "botoraptor"], true, { BOTORAPTOR_LIFECYCLE_LOCK_HELD: "1" })) {
        await restartDockerService();
        throw new Error("Docker rollback could not start Compose; the previous service was restarted where possible.");
    }
    if (!(await waitForHealth(60000))) throw new Error("Docker rollback did not pass the /health check.");
    log("Docker rollback completed with an atomic data restore and a healthy Compose service.");
}

async function statusUnlocked() {
    initializeData();
    const marker = readMarker();
    const processRunning = pidIsAlive();
    const reachable = await waitForHealth(1000);
    console.log(JSON.stringify({
        version: marker.version ?? releaseVersion,
        healthy: processRunning && reachable,
        processRunning,
        reachable,
        dockerMode: process.env.BOTORAPTOR_DOCKER_MODE === "1" || dockerComposeIsActive(),
        port: readPort(),
        data,
        config,
        database: path.join(db, "botoraptor.db"),
        uploads,
        backups,
        lastBackup: marker.backup ?? null,
    }, null, 2));
}

const command = process.argv[2] ?? "start";
if (process.env.BOTORAPTOR_SKIP_INSTALL_LIFECYCLE === "1") process.exit(0);

try {
    if (command === "start") await withLifecycleLock("start", () => startUnlocked());
    else if (command === "install") await withLifecycleLock("install", async () => {
        initializeData();
        installDependencies();
        buildApplications();
        await migrateDatabase();
    });
    else if (command === "update") await withLifecycleLock("update", updateUnlocked);
    else if (command === "status") await withLifecycleLock("health-status", statusUnlocked);
    else if (command === "rollback") {
        if (isDockerMode()) {
            await withLifecycleLock("restore", async () => {
                initializeData();
                restoreBackupUnlocked(readMarker().backup);
            });
        } else if (dockerComposeIsActive() || dockerComposeDeploymentExists()) await withLifecycleLock("docker-rollback", dockerRollbackUnlocked);
        else await withLifecycleLock("rollback", rollbackDirectUnlocked);
    } else if (command === "restore-data") {
        await withLifecycleLock("restore", async () => {
            initializeData();
            restoreBackupUnlocked(readMarker().backup);
        });
    } else if (command === "backup") {
        await withLifecycleLock("backup", async () => createBackupUnlocked());
    } else if (command === "docker-update") {
        await withLifecycleLock("docker-update", dockerUpdateUnlocked);
    } else if (command === "docker-rollback") {
        await withLifecycleLock("docker-rollback", dockerRollbackUnlocked);
    } else throw new Error(`Unknown command ${command}. Use start, install, update, status, rollback, backup, docker-update, or docker-rollback.`);
} catch (error) {
    fail(String(error?.stack ?? error));
}
