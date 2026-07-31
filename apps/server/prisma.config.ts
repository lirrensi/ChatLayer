// FILE: apps/server/prisma.config.ts
// PURPOSE: Point every Prisma CLI operation at the shared persistent SQLite database.
// OWNS: Prisma schema and migration configuration for direct and Docker execution.
// EXPORTS: Default Prisma configuration.
// DOCS: docs/core/server.md, .agents/reports/plan_safe-updates_2026-07-31.md

import { defineConfig } from "prisma/config";
import { databaseUrl } from "./src/runtimePaths";

const dbUrl = databaseUrl();

console.log(`[Prisma] Using persistent database: ${dbUrl}`);

export default defineConfig({
    schema: "prisma/schema.prisma",
    migrations: {
        path: "prisma/migrations",
        seed: "tsx prisma/seed.ts",
    },
    datasource: {
        url: dbUrl,
    },
});
