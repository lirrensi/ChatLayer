// FILE: apps/server/prisma/seed.ts
// PURPOSE: Provide the idempotent Prisma seed entrypoint for lifecycle tooling.
// OWNS: Optional initial data seeding without destructive database operations.
// EXPORTS: None; executed by Prisma.
// DOCS: docs/core/server.md

import { PrismaClient } from "../src/generated/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { databaseUrl } from "../src/runtimePaths";

const dbUrl = databaseUrl();

console.log(`[Seed] Using persistent database: ${dbUrl}`);

const adapter = new PrismaBetterSqlite3(dbUrl);
const prisma = new PrismaClient({ adapter });

async function seed() {
  console.log('Seeding database...')
  // Add your seeding logic here
  console.log('Seeding completed.')
}

seed()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
