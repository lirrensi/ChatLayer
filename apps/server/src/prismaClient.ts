// FILE: apps/server/src/prismaClient.ts
// PURPOSE: Provide the singleton Prisma client connected to the persistent data database.
// OWNS: Prisma adapter construction and connection lifecycle helpers.
// EXPORTS: Default Prisma client, connectPrisma, disconnectPrisma.
// DOCS: docs/core/server.md, apps/server/prisma/schema.prisma

import { PrismaClient } from "./generated/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { databaseUrl } from "./runtimePaths";

const dbUrl = databaseUrl();

console.log(`[Prisma Client] Using persistent database: ${dbUrl}`);

const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

export async function connectPrisma() {
    try {
        await prisma.$connect();
    } catch (e) {
        // ignore connect errors here; operations will fail loudly if needed
        console.error("Prisma connect error", e);
    }
}

export async function disconnectPrisma() {
    try {
        await prisma.$disconnect();
    } catch (e) {
        console.error("Prisma disconnect error", e);
    }
}

export default prisma;
