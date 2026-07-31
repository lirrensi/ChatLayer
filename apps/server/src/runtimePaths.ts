// FILE: apps/server/src/runtimePaths.ts
// PURPOSE: Resolve and initialize the shared application and persistent data directories for every server process.
// OWNS: Runtime root, data/config, data/db, data/uploads, and web build path resolution.
// EXPORTS: Runtime path constants and environment bootstrap helper.
// DOCS: docs/core/server.md, MIGRATION-v4.md

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

function resolveRepositoryRoot(): string {
    if (process.env.BOTORAPTOR_ROOT) {
        return path.resolve(process.env.BOTORAPTOR_ROOT);
    }

    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

export const repositoryRoot = resolveRepositoryRoot();
export const dataDirectory = path.resolve(process.env.BOTORAPTOR_DATA_DIR ?? path.join(repositoryRoot, "data"));
export const configDirectory = path.join(dataDirectory, "config");
export const databaseDirectory = path.join(dataDirectory, "db");
export const uploadsDirectory = path.join(dataDirectory, "uploads");
export const databaseFile = path.join(databaseDirectory, "botoraptor.db");
export const webDistributionDirectory = path.resolve(
    process.env.WEB_DIST_DIR ?? path.join(repositoryRoot, "apps", "web", "dist"),
);
export const serverConfigFile = path.join(configDirectory, "server.json");
export const clientConfigFile = path.join(configDirectory, "client.json");
export const runtimeEnvFile = path.join(dataDirectory, ".env");

function isMissingOrEmpty(filePath: string): boolean {
    return !fs.existsSync(filePath) || fs.statSync(filePath).size === 0;
}

/** Ensure a direct server start can read its persistent directories and defaults. */
export function initializeRuntimePaths(): void {
    for (const directory of [dataDirectory, configDirectory, databaseDirectory, uploadsDirectory]) {
        fs.mkdirSync(directory, { recursive: true });
    }

    const bundledConfigDirectory = path.join(repositoryRoot, "apps", "server", "config");
    for (const fileName of ["server.json", "client.json"]) {
        const destination = path.join(configDirectory, fileName);
        const source = path.join(bundledConfigDirectory, fileName);
        if (isMissingOrEmpty(destination) && fs.existsSync(source)) {
            fs.copyFileSync(source, destination);
        }
    }
}

export function databaseUrl(): string {
    return `file:${databaseFile}`;
}

export function loadRuntimeEnvironment(): void {
    initializeRuntimePaths();

    if (fs.existsSync(runtimeEnvFile)) {
        dotenv.config({ path: runtimeEnvFile, override: false });
    }

    process.env.BOTORAPTOR_ROOT ??= repositoryRoot;
    process.env.BOTORAPTOR_DATA_DIR ??= dataDirectory;
    process.env.DATABASE_URL = databaseUrl();
    process.env.DATABASE_URL_DEV = databaseUrl();
    process.env.DATABASE_URL_PROD = databaseUrl();
}

loadRuntimeEnvironment();
