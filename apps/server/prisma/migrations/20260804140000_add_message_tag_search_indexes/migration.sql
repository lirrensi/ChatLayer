-- FILE: apps/server/prisma/migrations/20260804140000_add_message_tag_search_indexes/migration.sql
-- PURPOSE: Add the normalized MessageTag read index and backfill legacy tag shapes once.
-- OWNS: MessageTag schema, search indexes, global option indexes, and JSON1 backfill.
-- EXPORTS: Persistent SQLite migration changes.
-- DOCS: .agents/reports/plan_production-search-filters_2026-08-04.md, docs/core/server.md

-- Normalize message tags once while retaining the source JSON columns.
CREATE TABLE "MessageTag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "messageId" INTEGER NOT NULL,
    "botId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "MessageTag_messageId_fkey"
        FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MessageTag_messageId_tag_key" ON "MessageTag"("messageId", "tag");
CREATE INDEX "MessageTag_botId_tag_createdAt_messageId_idx"
    ON "MessageTag"("botId", "tag", "createdAt", "messageId");
CREATE INDEX "MessageTag_botId_roomId_tag_createdAt_messageId_idx"
    ON "MessageTag"("botId", "roomId", "tag", "createdAt", "messageId");
CREATE INDEX "MessageTag_tag_idx"
    ON "MessageTag"("tag");

CREATE INDEX "Message_botId_roomId_createdAt_id_idx"
    ON "Message"("botId", "roomId", "createdAt", "id");
CREATE INDEX "Message_botId_messageType_roomId_createdAt_id_idx"
    ON "Message"("botId", "messageType", "roomId", "createdAt", "id");
CREATE INDEX "Message_botId_createdAt_id_idx"
    ON "Message"("botId", "createdAt", "id");
CREATE INDEX "Message_botId_idx"
    ON "Message"("botId");
CREATE INDEX "Message_messageType_idx"
    ON "Message"("messageType");

-- The composite (botId, roomId, createdAt, id) index above subsumes the legacy
-- (botId, roomId) index; drop the redundant one.
DROP INDEX "Message_botId_roomId_idx";

-- The source JSON remains authoritative. This backfill covers the supported
-- legacy shapes: arrays (including arrays containing {tag}/{tags} objects),
-- JSON-encoded arrays/objects, comma-separated strings, and tag/meta envelopes
-- using tags, tag, meta, metadata, data, message, or lastMessage keys.
WITH RECURSIVE
source("messageId", "botId", "roomId", "createdAt", "value") AS (
    SELECT "id", "botId", "roomId", "createdAt", "tags" FROM "Message" WHERE "tags" IS NOT NULL
    UNION ALL
    SELECT "id", "botId", "roomId", "createdAt", "meta" FROM "Message" WHERE "meta" IS NOT NULL
),
walk("messageId", "botId", "roomId", "createdAt", "value", "depth") AS (
    SELECT "messageId", "botId", "roomId", "createdAt", "value", 0 FROM source
    UNION ALL
    SELECT w."messageId", w."botId", w."roomId", w."createdAt", item.value, w.depth + 1
    FROM walk AS w
    JOIN json_each(w."value") AS item
    WHERE w.depth < 5
      AND json_valid(w."value")
      AND CASE WHEN json_valid(w."value") THEN json_type(w."value") END = 'array'
    UNION ALL
    SELECT w."messageId", w."botId", w."roomId", w."createdAt",
           json_extract(w."value", '$.' || keys.key), w.depth + 1
    FROM walk AS w
    JOIN (
        SELECT 'tags' AS key UNION ALL SELECT 'tag' UNION ALL SELECT 'meta'
        UNION ALL SELECT 'metadata' UNION ALL SELECT 'data' UNION ALL SELECT 'message'
        UNION ALL SELECT 'lastMessage'
    ) AS keys
    WHERE w.depth < 5
      AND json_valid(w."value")
      AND CASE WHEN json_valid(w."value") THEN json_type(w."value") END = 'object'
      AND json_extract(w."value", '$.' || keys.key) IS NOT NULL
      AND (
          (json_type(w."value", '$.tags') IS NOT NULL AND keys.key = 'tags')
          OR (
              json_type(w."value", '$.tags') IS NULL
              AND json_type(w."value", '$.tag') IS NOT NULL
              AND keys.key = 'tag'
          )
          OR (
              json_type(w."value", '$.tags') IS NULL
              AND json_type(w."value", '$.tag') IS NULL
              AND keys.key IN ('meta', 'metadata', 'data', 'message', 'lastMessage')
          )
      )
    UNION ALL
    SELECT w."messageId", w."botId", w."roomId", w."createdAt",
           json_extract(w."value", '$'), w.depth + 1
    FROM walk AS w
    WHERE w.depth < 5
      AND json_valid(w."value")
      AND CASE WHEN json_valid(w."value") THEN json_type(w."value") END = 'text'
      AND json_valid(json_extract(w."value", '$'))
      AND CASE
          WHEN json_valid(json_extract(w."value", '$'))
          THEN json_type(json_extract(w."value", '$'))
      END IN ('array', 'object')
),
leaves("messageId", "botId", "roomId", "createdAt", "value") AS (
    SELECT "messageId", "botId", "roomId", "createdAt",
           CASE
               WHEN json_valid("value") AND json_type("value") = 'text'
               THEN json_extract("value", '$')
               ELSE "value"
           END
    FROM walk
    WHERE typeof("value") = 'text'
      AND NOT (
          json_valid("value")
          AND CASE WHEN json_valid("value") THEN json_type("value") END IN ('array', 'object')
      )
),
parts("messageId", "botId", "roomId", "createdAt", "tag", "remainder") AS (
    SELECT "messageId", "botId", "roomId", "createdAt",
           trim(substr("value", 1, instr("value" || ',', ',') - 1)),
           substr("value", instr("value" || ',', ',') + 1)
    FROM leaves
    WHERE "value" IS NOT NULL
    UNION ALL
    SELECT "messageId", "botId", "roomId", "createdAt",
           trim(substr("remainder", 1, instr("remainder" || ',', ',') - 1)),
           substr("remainder", instr("remainder" || ',', ',') + 1)
    FROM parts
    WHERE "remainder" <> ''
)
INSERT OR IGNORE INTO "MessageTag" ("messageId", "botId", "roomId", "tag", "createdAt")
SELECT "messageId", "botId", "roomId", "tag", "createdAt"
FROM parts
WHERE "tag" <> '';
