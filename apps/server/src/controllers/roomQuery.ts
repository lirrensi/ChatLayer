// FILE: apps/server/src/controllers/roomQuery.ts
// PURPOSE: Select indexed candidate rooms, recent-depth matches, and latest previews in two candidate-first SQL queries.
// OWNS: SQL-only room candidate, recency, filter, cursor, and preview selection.
// EXPORTS: queryRooms.
// DOCS: .agents/reports/plan_production-search-filters_2026-08-04.md, docs/core/server.md

import { Prisma } from "../generated/client";
import prisma from "../prismaClient";

export type RoomQueryRow = {
    id: number;
    roomId: string;
    text: string;
    createdAt: Date;
    messageType: string;
    attachments: unknown;
    meta: unknown;
    tags: unknown;
};

/**
 * The timestamp cursor deliberately excludes every message at the cursor
 * timestamp, matching the existing room-list API contract.
 */
export async function queryRooms(
    botId: string,
    typeFilters: string[],
    tagFilters: string[],
    depth: number,
    limit: number,
    cursorCreatedAt: Date | null,
): Promise<RoomQueryRow[]> {
    const cursorCandidateTypeClause = cursorCreatedAt
        ? Prisma.sql`AND candidate_type."createdAt" < ${cursorCreatedAt}`
        : Prisma.empty;
    const cursorCandidateMessageClause = cursorCreatedAt
        ? Prisma.sql`AND candidate_message."createdAt" < ${cursorCreatedAt}`
        : Prisma.empty;
    const cursorRecentClause = cursorCreatedAt
        ? Prisma.sql`AND recent."createdAt" < ${cursorCreatedAt}`
        : Prisma.empty;
    const cursorTagClause = cursorCreatedAt
        ? Prisma.sql`AND indexed_tag."createdAt" < ${cursorCreatedAt}`
        : Prisma.empty;

    // Filtered rooms begin with indexed room candidates. INTERSECT preserves the
    // type/tag AND semantics without making the recent-window query inspect every
    // room in the bot. With no filters, the message room index supplies candidates.
    const candidateRooms = typeFilters.length > 0 && tagFilters.length > 0
        ? Prisma.sql`
            SELECT DISTINCT candidate_type."roomId"
            FROM "Message" AS candidate_type
            WHERE candidate_type."botId" = ${botId}
              AND candidate_type."messageType" IN (${Prisma.join(typeFilters)})
              ${cursorCandidateTypeClause}
            INTERSECT
            SELECT DISTINCT candidate_tag."roomId"
            FROM "MessageTag" AS candidate_tag
            WHERE candidate_tag."botId" = ${botId}
              AND candidate_tag."tag" IN (${Prisma.join(tagFilters)})
              ${cursorCreatedAt ? Prisma.sql`AND candidate_tag."createdAt" < ${cursorCreatedAt}` : Prisma.empty}
        `
        : typeFilters.length > 0
            ? Prisma.sql`
                SELECT DISTINCT candidate_type."roomId"
                FROM "Message" AS candidate_type
                WHERE candidate_type."botId" = ${botId}
                  AND candidate_type."messageType" IN (${Prisma.join(typeFilters)})
                  ${cursorCandidateTypeClause}
            `
            : tagFilters.length > 0
                ? Prisma.sql`
                    SELECT DISTINCT candidate_tag."roomId"
                    FROM "MessageTag" AS candidate_tag
                    WHERE candidate_tag."botId" = ${botId}
                      AND candidate_tag."tag" IN (${Prisma.join(tagFilters)})
                      ${cursorCreatedAt ? Prisma.sql`AND candidate_tag."createdAt" < ${cursorCreatedAt}` : Prisma.empty}
                `
                : Prisma.sql`
                    SELECT DISTINCT candidate_message."roomId"
                    FROM "Message" AS candidate_message
                    WHERE candidate_message."botId" = ${botId}
                      ${cursorCandidateMessageClause}
                `;

    const typeMatch = typeFilters.length > 0
        ? Prisma.sql`
            EXISTS (
                SELECT 1
                FROM "Message" AS recent
                WHERE recent."botId" = ${botId}
                  AND recent."roomId" = boundary."roomId"
                  ${cursorRecentClause}
                  AND recent."messageType" IN (${Prisma.join(typeFilters)})
                  AND (
                      boundary."boundaryId" IS NULL
                      OR recent."createdAt" > boundary."boundaryCreatedAt"
                      OR (
                          recent."createdAt" = boundary."boundaryCreatedAt"
                          AND recent."id" >= boundary."boundaryId"
                      )
                  )
                LIMIT 1
            )
        `
        : Prisma.sql`1 = 1`;
    const tagMatch = tagFilters.length > 0
        ? Prisma.sql`
            EXISTS (
                SELECT 1
                FROM "MessageTag" AS indexed_tag
                WHERE indexed_tag."botId" = ${botId}
                  AND indexed_tag."roomId" = boundary."roomId"
                  ${cursorTagClause}
                  AND indexed_tag."tag" IN (${Prisma.join(tagFilters)})
                  AND (
                      boundary."boundaryId" IS NULL
                      OR indexed_tag."createdAt" > boundary."boundaryCreatedAt"
                      OR (
                          indexed_tag."createdAt" = boundary."boundaryCreatedAt"
                          AND indexed_tag."messageId" >= boundary."boundaryId"
                      )
                  )
                LIMIT 1
            )
        `
        : Prisma.sql`1 = 1`;

    // Candidate-first selection: drive the query from the small set of matching
    // rooms instead of the bot's full message history. Without ANALYZE statistics
    // SQLite otherwise drives the outer loop from the Message table and re-derives
    // the CTE chain per row, which turns sparse filters into full-history scans.
    const matching = await prisma.$queryRaw<Array<{ roomId: string; latestCreatedAt: Date; latestId: number }>>(Prisma.sql`
        WITH candidate_rooms AS (
            ${candidateRooms}
        ),
        recent_boundaries AS (
            SELECT
                candidate."roomId",
                (
                    SELECT recent."id"
                    FROM "Message" AS recent
                    WHERE recent."botId" = ${botId}
                      AND recent."roomId" = candidate."roomId"
                      ${cursorRecentClause}
                    ORDER BY recent."createdAt" DESC, recent."id" DESC
                    LIMIT 1 OFFSET ${depth - 1}
                ) AS "boundaryId",
                (
                    SELECT recent."createdAt"
                    FROM "Message" AS recent
                    WHERE recent."botId" = ${botId}
                      AND recent."roomId" = candidate."roomId"
                      ${cursorRecentClause}
                    ORDER BY recent."createdAt" DESC, recent."id" DESC
                    LIMIT 1 OFFSET ${depth - 1}
                ) AS "boundaryCreatedAt"
            FROM candidate_rooms AS candidate
        ),
        matching_rooms AS (
            SELECT boundary."roomId"
            FROM recent_boundaries AS boundary
            WHERE ${typeMatch}
              AND ${tagMatch}
        )
        SELECT
            matching."roomId",
            (
                SELECT latest."createdAt"
                FROM "Message" AS latest
                WHERE latest."botId" = ${botId}
                  AND latest."roomId" = matching."roomId"
                  ${cursorCreatedAt ? Prisma.sql`AND latest."createdAt" < ${cursorCreatedAt}` : Prisma.empty}
                ORDER BY latest."createdAt" DESC, latest."id" DESC
                LIMIT 1
            ) AS "latestCreatedAt",
            (
                SELECT latest."id"
                FROM "Message" AS latest
                WHERE latest."botId" = ${botId}
                  AND latest."roomId" = matching."roomId"
                  ${cursorCreatedAt ? Prisma.sql`AND latest."createdAt" < ${cursorCreatedAt}` : Prisma.empty}
                ORDER BY latest."createdAt" DESC, latest."id" DESC
                LIMIT 1
            ) AS "latestId"
        FROM matching_rooms AS matching
        ORDER BY "latestCreatedAt" DESC, "latestId" DESC
        LIMIT ${limit}
    `);

    if (matching.length === 0) return [];

    // Second pass: fetch the selected latest-message rows by primary key. The
    // cursor and limit decisions were already made by the candidate query.
    return prisma.$queryRaw<RoomQueryRow[]>(Prisma.sql`
        SELECT "id", "roomId", "text", "createdAt", "messageType", "attachments", "meta", "tags"
        FROM "Message"
        WHERE "id" IN (${Prisma.join(matching.map(row => row.latestId))})
        ORDER BY "createdAt" DESC, "id" DESC
    `);
}
