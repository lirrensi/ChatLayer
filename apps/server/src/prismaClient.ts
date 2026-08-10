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

// Fail fast when the compiled Prisma client is stale and lacks model delegates
// the application depends on. A stale client (e.g. dist built from an older
// schema) otherwise serves confusing 500s on the first tagged write, such as
// `transaction.messageTag.createMany` being undefined.
const requiredDelegates = ["user", "message", "messageTag"] as const;
const missingDelegates = requiredDelegates.filter(
    delegate => (prisma as unknown as Record<string, unknown>)[delegate] === undefined,
);
if (missingDelegates.length > 0) {
    console.error(
        `[Prisma Client] ERROR: the compiled Prisma client is missing model delegate(s): ${missingDelegates.join(", ")}. ` +
        "This usually means apps/server/dist contains a stale Prisma client built from an older schema. " +
        "Run `node tools/botoraptor.mjs update` from the repository root, or remove apps/server/dist and re-run `npm start`.",
    );
    throw new Error(
        `Stale Prisma client: missing model delegate(s) ${missingDelegates.join(", ")}. ` +
        "Run `node tools/botoraptor.mjs update`, or remove apps/server/dist and re-run `npm start`.",
    );
}

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
