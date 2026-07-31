// FILE: tools/lifecycle-smoke.mjs
// PURPOSE: Exercise lifecycle lock recovery, backup creation, and atomic data restoration in an isolated temporary directory.
// OWNS: Focused CLI-level safety smoke checks that do not start the API server or touch repository data.
// EXPORTS: Executable lifecycle smoke test.
// DOCS: README.md, MIGRATION-v4.md

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = fs.mkdtempSync(path.join(os.tmpdir(), "botoraptor-lifecycle-"));
const launcher = path.join(root, "tools", "botoraptor.mjs");
const environment = {
    ...process.env,
    BOTORAPTOR_DATA_DIR: data,
    BOTORAPTOR_DISABLE_DOCKER_DETECT: "1",
    BOTORAPTOR_IMAGE: "1",
};

function run(command) {
    return spawnSync(process.execPath, [launcher, command], {
        cwd: root,
        env: environment,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    });
}

try {
    fs.mkdirSync(path.join(data, "uploads"), { recursive: true });
    fs.writeFileSync(path.join(data, "uploads", "smoke.txt"), "original upload\n");
    const firstBackup = run("backup");
    assert.equal(firstBackup.status, 0, firstBackup.stderr);

    const lockPath = path.join(data, ".lifecycle.lock");
    fs.writeFileSync(lockPath, `${JSON.stringify({
        operation: "smoke-lock",
        pid: process.pid,
        host: os.hostname(),
        startedAt: new Date().toISOString(),
        token: "smoke-lock",
    })}\n`);
    const blocked = run("status");
    assert.notEqual(blocked.status, 0, "a live lifecycle owner must block a second operation");
    fs.rmSync(lockPath, { force: true });

    const backupDirectories = fs.readdirSync(path.join(data, "backups"), { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(data, "backups", entry.name));
    assert.equal(backupDirectories.length, 1, "the initial backup should be present");
    const backup = backupDirectories[0];
    const markerPath = path.join(data, "release.json");
    fs.writeFileSync(markerPath, `${JSON.stringify({ version: "4.0.0", backup })}\n`);

    const originalConfig = fs.readFileSync(path.join(data, "config", "server.json"), "utf8");
    const originalUpload = fs.readFileSync(path.join(data, "uploads", "smoke.txt"), "utf8");
    fs.writeFileSync(path.join(data, "config", "server.json"), `${originalConfig}\n\n`);
    fs.writeFileSync(path.join(data, "uploads", "smoke.txt"), "changed upload\n");
    const restored = run("restore-data");
    assert.equal(restored.status, 0, restored.stderr);
    assert.equal(fs.readFileSync(path.join(data, "config", "server.json"), "utf8"), originalConfig);
    assert.equal(fs.readFileSync(path.join(data, "uploads", "smoke.txt"), "utf8"), originalUpload);

    const allBackups = fs.readdirSync(path.join(data, "backups"), { withFileTypes: true })
        .filter(entry => entry.isDirectory());
    assert.ok(allBackups.length >= 2, "restore must retain a safety backup");
    assert.ok(!fs.existsSync(lockPath), "lifecycle lock must always be released");

    fs.writeFileSync(lockPath, `${JSON.stringify({
        operation: "stale-smoke-lock",
        pid: 999999,
        host: os.hostname(),
        startedAt: "2020-01-01T00:00:00.000Z",
        token: "stale-smoke-lock",
    })}\n`);
    const staleRecovery = run("status");
    assert.equal(staleRecovery.status, 0, staleRecovery.stderr);
    assert.ok(!fs.existsSync(lockPath), "stale lifecycle lock must be removed");

    console.log("Lifecycle smoke checks passed.");
} finally {
    fs.rmSync(data, { recursive: true, force: true });
}
