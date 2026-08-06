// FILE: apps/server/src/controllers/messageController.ts
// PURPOSE: Persist messages and assemble bot-scoped room views with recent-message filters.
// OWNS: Atomic message/tag writes and indexed message, bot, room, and filter-option reads.
// EXPORTS: Message CRUD helpers, getBots, getMessages, getRooms, and getFilterOptions.
// DOCS: .agents/reports/plan_production-search-filters_2026-08-04.md, docs/core/server.md

import { Prisma } from "../generated/client";
import prisma from "../prismaClient";
import { queryRooms } from "./roomQuery";

/**
 * Local TypeScript interfaces that mirror the Prisma schema.
 * We avoid importing generated types from @prisma/client here to prevent
 * type errors in environments where those exports are not available.
 */

export type Attachment = {
    id: string;
    type: "image" | "video" | "document" | "file";
    isExternal: boolean;
    url?: string | null;
    filename?: string | null;
    original_name?: string | null;

    mime_type?: string;
    size?: number;

    createdAt?: Date;
};

export type User = {
    id: number;
    botId: string;
    userId: string;
    username: string;
    name?: string | null;
    createdAt: Date;
    blocked: boolean;
};

export type Message = {
    id: number;
    botId: string;
    roomId: string;
    userId: string;
    messageType:
        | "user_message"
        | "user_message_service"
        | "bot_message_service"
        | "manager_message"
        | "service_call"
        | "error_message"
        | "event"
        | string;
    text: string;
    attachments?: Attachment[] | null;
    meta?: Record<string, any> | null;
    tags?: string[] | null;
    createdAt: Date;
};

export type AddMessageInput = {
    botId: string;
    roomId: string;
    userId: string;
    username?: string;
    name?: string | null;
    messageType?: Message["messageType"];
    text?: string;
    attachments?: Attachment[] | null;
    meta?: Record<string, any> | null;
    tags?: any;
};

export async function createOrGetUser(
    botId: string,
    userId: string,
    username?: string,
    name?: string | null,
): Promise<User> {
    const existing = await prisma.user.findFirst({
        where: { botId, userId },
    });

    if (existing) return existing as unknown as User;

    return (await prisma.user.create({
        data: {
            botId,
            userId,
            username: username ?? userId,
            name,
        },
    })) as unknown as User;
}

/**
 * addUser
 * - simple exported helper that mirrors createOrGetUser for API usage
 */
export async function addUser(botId: string, userId: string, username?: string, name?: string | null): Promise<User> {
    return createOrGetUser(botId, userId, username, name);
}

export async function addMessage(payload: AddMessageInput): Promise<Message> {
    const {
        botId,
        userId,
        username,
        name,
        roomId,
        messageType = "user_message",
        text = "",
        attachments = null,
        meta = null,
        tags = null,
    } = payload;

    const indexedTags = normalizeTagValues([tags, meta]);
    const msg = await prisma.$transaction(async transaction => {
        const existingUser = await transaction.user.findFirst({
            where: { botId, userId },
        });
        if (!existingUser) {
            await transaction.user.create({
                data: {
                    botId,
                    userId,
                    username: username ?? userId,
                    name,
                },
            });
        }

        const created = await transaction.message.create({
            data: {
                botId,
                roomId,
                userId,
                messageType: messageType as any,
                text,
                // Prisma expects Json for attachments/meta; cast at call site
                attachments: attachments ? (attachments as any) : null,
                meta: meta ? (meta as any) : null,
                tags: tags ? (tags as any) : null,
            },
        });

        if (indexedTags.length > 0) {
            await transaction.messageTag.createMany({
                data: indexedTags.map(tag => ({
                    messageId: created.id,
                    botId: created.botId,
                    roomId: created.roomId,
                    tag,
                    createdAt: created.createdAt,
                })),
            });
        }

        return created;
    });

    return msg as unknown as Message;
}

export type GetMessagesOptions = {
    botId?: string;
    roomId?: string;
    userId?: string;
    cursorId?: number;
    limit?: number;
    types?: Message["messageType"][];
    tags?: string[];
    longPoll?: boolean;
    timeout?: number;
};

/**
 * getMessages(opts)
 * - Returns messages matching the given filters, newest first (createdAt desc,
 *   id desc for deterministic tie order).
 * - Message type filters are ORed via the SQL `in` clause. Tag filters are ORed
 *   within the tag group and ANDed with the type group through MessageTag.
 * - The query never materializes or scans message history in application code.
 */
export async function getMessages(opts: GetMessagesOptions = {}) {
    const where: any = {};
    if (opts.botId) where.botId = opts.botId;
    if (opts.roomId) where.roomId = opts.roomId;
    if (opts.userId) where.userId = opts.userId;
    if (opts.types && opts.types.length > 0) where.messageType = { in: opts.types };

    if (typeof opts.cursorId === "number") {
        const cursorMessage = await prisma.message.findUnique({
            where: { id: opts.cursorId },
            select: { createdAt: true, id: true },
        });
        if (cursorMessage) {
            where.OR = [
                { createdAt: { lt: cursorMessage.createdAt } },
                { createdAt: cursorMessage.createdAt, id: { lt: cursorMessage.id } },
            ];
        }
    }

    const effectiveLimit = Math.max(1, Math.min(Number(opts.limit) || 50, 500));
    const tagFilters = normalizedFilterValues(opts.tags);
    if (tagFilters.length > 0) {
        where.tagIndex = { some: { tag: { in: tagFilters } } };
    }

    const messages = await prisma.message.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: effectiveLimit,
    });
    return messages as unknown as Message[];
}

export async function getBots(): Promise<string[]> {
    const rows = await prisma.$queryRaw<Array<{ botId: string }>>(Prisma.sql`
        SELECT DISTINCT "botId"
        FROM "Message"
        ORDER BY "botId" ASC
    `);
    return rows.map(row => row.botId);
}

export type RoomInfo = {
    botId: string;
    roomId: string;
    users: User[];
    lastMessage?: Message | null;
};

export type GetRoomsOptions = {
    botId: string;
    messageType?: string; // Legacy singular message type filter
    messageTypes?: string[]; // OR filter for multiple message types
    depth?: number; // Default 5 - check if type appears in last N messages
    limit?: number; // Max rooms to return (default 50, max 500)
    cursorId?: string; // Pagination cursor (message id)
    tags?: string[]; // OR filter for tags; AND with message type filters
};

/** Normalize legacy JSON, string, array, and metadata tag shapes to unique labels. */
export function normalizeTagValues(value: unknown): string[] {
    const result: string[] = [];
    const seen = new Set<string>();

    const visit = (input: unknown, depth = 0): void => {
        if (input == null || depth > 5) return;

        if (Array.isArray(input)) {
            input.forEach(item => visit(item, depth + 1));
            return;
        }

        if (typeof input === "string") {
            const text = input.trim();
            if (!text) return;

            if ((text.startsWith("[") && text.endsWith("]")) || (text.startsWith("{") && text.endsWith("}"))) {
                try {
                    visit(JSON.parse(text), depth + 1);
                    return;
                } catch {
                    // Treat malformed JSON as a literal tag below.
                }
            }

            text.split(",").forEach(part => {
                const tag = part.trim();
                if (tag && !seen.has(tag)) {
                    seen.add(tag);
                    result.push(tag);
                }
            });
            return;
        }

        if (typeof input !== "object") return;

        const record = input as Record<string, unknown>;
        if ("tags" in record) {
            visit(record.tags, depth + 1);
        } else if ("tag" in record) {
            visit(record.tag, depth + 1);
        } else {
            ["meta", "metadata", "data", "message", "lastMessage"].forEach(key => {
                if (key in record) visit(record[key], depth + 1);
            });
        }
    };

    visit(value);
    return result;
}

function normalizedFilterValues(values: unknown): string[] {
    if (!Array.isArray(values)) return [];
    return Array.from(new Set(values.map(value => String(value).trim()).filter(Boolean)));
}

export type FilterOptions = {
    messageTypes: string[];
    tags: string[];
};

/** Return distinct message types and tags from every persisted message. */
export async function getFilterOptions(): Promise<FilterOptions> {
    const [typeRows, tagRows] = await Promise.all([
        prisma.$queryRaw<Array<{ messageType: string }>>(Prisma.sql`
            SELECT DISTINCT "messageType"
            FROM "Message"
            WHERE "messageType" IS NOT NULL
            ORDER BY "messageType" ASC
        `),
        prisma.$queryRaw<Array<{ tag: string }>>(Prisma.sql`
            SELECT DISTINCT "tag"
            FROM "MessageTag"
            WHERE "tag" <> ''
            ORDER BY "tag" ASC
        `),
    ]);

    return {
        messageTypes: typeRows.map(row => String(row.messageType)),
        tags: tagRows.map(row => String(row.tag)),
    };
}

/**
 * getRooms preserves the latest preview, recent-depth semantics, users, ordering,
 * limit, and timestamp cursor while keeping history selection in SQL.
 */
export async function getRooms(opts: GetRoomsOptions): Promise<{ rooms: RoomInfo[] }> {
    const {
        botId,
        messageType,
        messageTypes,
        depth = 10,
        limit = 50,
        cursorId,
        tags,
    } = opts;
    const effectiveLimit = Math.max(1, Math.min(Number(limit) || 50, 500));

    if (!botId) {
        throw new Error("botId is required");
    }

    const typeFilters = normalizedFilterValues([
        ...(messageTypes ?? []),
        ...(messageType ? [messageType] : []),
    ]);
    const tagFilters = normalizedFilterValues(tags);
    const effectiveDepth = Math.max(1, Math.floor(Number(depth) || 10));
    let cursorCreatedAt: Date | null = null;

    if (cursorId) {
        const parsedCursorId = parseInt(cursorId, 10);
        const cursorMessage = Number.isFinite(parsedCursorId)
            ? await prisma.message.findUnique({
                where: { id: parsedCursorId },
                select: { createdAt: true },
            })
            : null;
        cursorCreatedAt = cursorMessage?.createdAt ?? null;
    }

    const selectedRooms = await queryRooms(
        botId,
        typeFilters,
        tagFilters,
        effectiveDepth,
        effectiveLimit,
        cursorCreatedAt,
    );
    const roomIds = selectedRooms.map(room => room.roomId);
    if (roomIds.length === 0) return { rooms: [] };

    const roomUserRows = await prisma.message.groupBy({
        by: ["roomId", "userId"],
        where: {
            botId,
            ...(cursorCreatedAt ? { createdAt: { lt: cursorCreatedAt } } : {}),
            roomId: { in: roomIds },
        },
    });

    const roomUserIds = new Map<string, Set<string>>();
    for (const row of roomUserRows) {
        const userIds = roomUserIds.get(row.roomId) ?? new Set<string>();
        userIds.add(row.userId);
        roomUserIds.set(row.roomId, userIds);
    }

    const allUserIds = new Set<string>();
    for (const room of selectedRooms) {
        const userIds = roomUserIds.get(room.roomId) ?? new Set<string>();
        userIds.forEach(userId => allUserIds.add(userId));
    }

    const users = await prisma.user.findMany({
        where: { botId, userId: { in: Array.from(allUserIds) } },
        select: { userId: true, username: true, name: true },
    });
    const userMap = new Map(users.map(user => [user.userId, user]));

    const rooms: RoomInfo[] = selectedRooms.map(room => {
        const roomUsers = Array.from(roomUserIds.get(room.roomId) ?? [])
            .map(userId => userMap.get(userId))
            .filter(Boolean)
            .map(user => ({
                id: 0,
                botId,
                userId: user!.userId,
                username: user!.username,
                name: user!.name,
                createdAt: new Date(),
                blocked: false,
            })) as User[];

        return {
            botId,
            roomId: room.roomId,
            users: roomUsers,
            lastMessage: {
                id: room.id,
                text: room.text,
                createdAt: room.createdAt,
                messageType: room.messageType,
                attachments: room.attachments,
                meta: room.meta,
                tags: room.tags,
            } as Message,
        };
    });

    return { rooms };
}
