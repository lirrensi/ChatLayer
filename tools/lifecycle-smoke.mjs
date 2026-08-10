// FILE: tools/lifecycle-smoke.mjs
// PURPOSE: Exercise lifecycle lock recovery, backup creation, atomic data restoration, and launcher build-freshness decisions in an isolated temporary directory.
// OWNS: Focused CLI-level safety smoke checks that do not start the API server or touch repository data.
// EXPORTS: Executable lifecycle smoke test.
// DOCS: README.md, MIGRATION-v4.md

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildDecisions, isMissingOrNewer } from "./build-policy.mjs";

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

    // Build-freshness decision matrix. Uses temporary fixture paths with
    // controlled mtimes so the pure helper can be asserted without a build.
    const fixtureDir = path.join(data, "build-policy-fixtures");
    const fixture = {
        schemaFile: path.join(fixtureDir, "schema.prisma"),
        generatedClient: path.join(fixtureDir, "generated", "client.ts"),
        compiledServer: path.join(fixtureDir, "dist", "index.js"),
        compiledClient: path.join(fixtureDir, "dist", "generated", "client.js"),
    };
    function writeFixture(filePath, mtimeMs) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, "fixture");
        fs.utimesSync(filePath, new Date(mtimeMs), new Date(mtimeMs));
    }
    const OLD = 1000;
    const NEW = 2000;

    // Case 1: schema newer than generated client -> regenerate + rebuild.
    writeFixture(fixture.schemaFile, NEW);
    writeFixture(fixture.generatedClient, OLD);
    writeFixture(fixture.compiledServer, OLD);
    writeFixture(fixture.compiledClient, OLD);
    assert.deepEqual(
        buildDecisions({ force: false, ...fixture }),
        { regenerateClient: true, rebuildServer: true },
        "a schema newer than the generated client must regenerate and rebuild",
    );

    // Case 2: generated client missing -> regenerate + rebuild.
    fs.rmSync(fixture.generatedClient, { force: true });
    assert.deepEqual(
        buildDecisions({ force: false, ...fixture }),
        { regenerateClient: true, rebuildServer: true },
        "a missing generated client must regenerate and rebuild",
    );

    // Case 3: generated client newer than compiled client -> rebuild only.
    writeFixture(fixture.generatedClient, NEW);
    writeFixture(fixture.compiledClient, OLD);
    assert.deepEqual(
        buildDecisions({ force: false, ...fixture }),
        { regenerateClient: false, rebuildServer: true },
        "a generated client newer than the compiled client must rebuild without regenerating",
    );

    // Case 4: everything current -> skip both.
    writeFixture(fixture.schemaFile, OLD);
    writeFixture(fixture.compiledServer, NEW);
    writeFixture(fixture.compiledClient, NEW);
    assert.deepEqual(
        buildDecisions({ force: false, ...fixture }),
        { regenerateClient: false, rebuildServer: false },
        "current artifacts must skip both generate and build",
    );

    // Case 5: force=true -> regenerate + rebuild unconditionally.
    assert.deepEqual(
        buildDecisions({ force: true, ...fixture }),
        { regenerateClient: true, rebuildServer: true },
        "force must regenerate and rebuild unconditionally",
    );

    // isMissingOrNewer edge behavior.
    assert.equal(isMissingOrNewer(fixture.schemaFile, path.join(fixtureDir, "absent")), true, "a present probe beats a missing reference");
    assert.equal(isMissingOrNewer(path.join(fixtureDir, "absent"), fixture.schemaFile), false, "a missing probe is never newer");

    console.log("Lifecycle smoke checks passed.");
} finally {
    fs.rmSync(data, { recursive: true, force: true });
}
