// FILE: apps/server/scripts/reconcile-message-tags.ts
// PURPOSE: Populate the normalized MessageTag table for a legacy database reconciled by db push.
// OWNS: One-time, idempotent derived-index reconciliation outside normal server updates.
// EXPORTS: reconcileMessageTags.
// DOCS: .agents/reports/plan_production-search-filters_2026-08-04.md, docs/core/server.md

import prisma from "../src/prismaClient.js";
import { normalizeTagValues } from "../src/controllers/messageController.js";
import { pathToFileURL } from "node:url";

const BATCH_SIZE = 500;
const TRANSACTION_TIMEOUT_MS = 5 * 60 * 1000;

export type ReconcileMessageTagsOptions = {
    /** Restrict reconciliation to one bot when repairing a scoped legacy fixture. */
    botId?: string;
};

export async function reconcileMessageTags(options: ReconcileMessageTagsOptions = {}): Promise<number> {
    if (options.botId !== undefined && !options.botId.trim()) {
        throw new Error("botId must not be empty when scoping message-tag reconciliation");
    }

    const messageScope = options.botId === undefined ? {} : { botId: options.botId };

    return prisma.$transaction(async transaction => {
        // MessageTag is derived data. Replacing only this table makes retries safe,
        // while keeping the delete and every keyset batch in one atomic transaction.
        await transaction.messageTag.deleteMany({ where: messageScope });

        let indexed = 0;
        let lastMessageId = 0;
        while (true) {
            const batch = await transaction.message.findMany({
                where: { ...messageScope, id: { gt: lastMessageId } },
                select: {
                    id: true,
                    botId: true,
                    roomId: true,
                    createdAt: true,
                    tags: true,
                    meta: true,
                },
                orderBy: { id: "asc" },
                take: BATCH_SIZE,
            });
            if (batch.length === 0) break;

            const rows = batch.flatMap(message => normalizeTagValues([message.tags, message.meta]).map(tag => ({
                messageId: message.id,
                botId: message.botId,
                roomId: message.roomId,
                tag,
                createdAt: message.createdAt,
            })));
            if (rows.length > 0) {
                await transaction.messageTag.createMany({ data: rows });
                indexed += rows.length;
            }
            lastMessageId = batch[batch.length - 1].id;
        }

        return indexed;
    }, { maxWait: 10_000, timeout: TRANSACTION_TIMEOUT_MS });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    reconcileMessageTags()
        .then(indexed => {
            console.log(`Reconciled ${indexed} normalized message tags.`);
        })
        .catch(error => {
            console.error("Legacy message-tag reconciliation failed", error);
            process.exitCode = 1;
        })
        .finally(() => prisma.$disconnect());
}
