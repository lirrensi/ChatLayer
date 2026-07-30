// FILE: server/src/controllers/messageController.ts
// PURPOSE: Persist messages and assemble bot-scoped room views with recent-message filters.
// OWNS: Message, user, room, and complete-database filter-option queries.
// EXPORTS: Message CRUD helpers, getRooms, and getFilterOptions.
// DOCS: .agents/reports/plan_multi-filter_2026-07-31.md, docs/core/server.md

import prisma from "../prismaClient";

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

    // ensure user exists
    await createOrGetUser(botId, userId, username, name);

    const msg = await prisma.message.create({
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

    return msg as unknown as Message;
}

export type GetMessagesOptions = {
    botId?: string;
    roomId?: string;
    userId?: string;
    cursorId?: number;
    limit?: number;
    types?: Message["messageType"][];
    longPoll?: boolean;
    timeout?: number;
};

export async function getMessages(opts: GetMessagesOptions = {}) {
    const where: any = {};
    if (opts.botId) where.botId = opts.botId;
    if (opts.roomId) where.roomId = opts.roomId;
    if (opts.userId) where.userId = opts.userId;
    if (typeof opts.cursorId === "number") where.id = { lt: opts.cursorId };
    if (opts.types && opts.types.length > 0) where.messageType = { in: opts.types };

    const messages = await prisma.message.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: opts.limit ?? 50,
    });

    return messages as unknown as Message[];
}

export async function getBots(): Promise<string[]> {
    // Fetch all botIds from messages and return unique list.
    const rows = await prisma.message.findMany({
        select: { botId: true },
        orderBy: { botId: "asc" },
    });

    const bots = Array.from(new Set(rows.map((r: any) => r.botId)));
    return bots;
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
    const rows = await prisma.message.findMany({
        select: { messageType: true, tags: true, meta: true },
    });

    const messageTypes = new Set<string>();
    const tags = new Set<string>();
    for (const row of rows) {
        if (row.messageType) messageTypes.add(String(row.messageType));
        normalizeTagValues([row.tags, row.meta]).forEach(tag => tags.add(tag));
    }

    return {
        messageTypes: Array.from(messageTypes).sort((a, b) => a.localeCompare(b)),
        tags: Array.from(tags).sort((a, b) => a.localeCompare(b)),
    };
}

/**
 * getRooms(opts)
 * - Scans messages for the given botId and returns a list of rooms.
 * - Each room includes the botId, roomId, array of users present in the room,
 *   and the most recent message for that room (lastMessage).
 * - Optional filtering by message type and tags with a depth check: each selected
 *   group uses OR semantics, while message type and tag groups are ANDed together.
 * - Pagination: uses cursorId for efficient scrolling through large datasets.
 * - Batch user fetch: fetches all users in a single query (fixes N+1 problem).
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
    const effectiveLimit = Math.max(1, Math.min(Number(limit) || 50, 500)); // Cap at 500

    if (!botId) {
        throw new Error("botId is required");
    }

    const typeFilters = normalizedFilterValues([
        ...(messageTypes ?? []),
        ...(messageType ? [messageType] : []),
    ]);
    const tagFilters = normalizedFilterValues(tags);
    const effectiveDepth = Math.max(1, Math.floor(Number(depth) || 10));
    const hasFilters = typeFilters.length > 0 || tagFilters.length > 0;

    // Build the external cursor boundary. The cursor contract historically excludes
    // every message at the cursor's timestamp, so keep that behavior unchanged.
    const whereClause: any = { botId };
    
    // If cursor provided, filter to messages before that cursor
    if (cursorId) {
        const parsedCursorId = parseInt(cursorId, 10);
        const cursorMessage = Number.isFinite(parsedCursorId)
            ? await prisma.message.findUnique({
                where: { id: parsedCursorId },
                select: { createdAt: true },
            })
            : null;
        if (cursorMessage) {
            whereClause.createdAt = { lt: cursorMessage.createdAt };
        }
    }

    type RoomCandidate = {
        roomId: string;
        lastMessage: any;
        userIds: Set<string>;
    };

    const selectedRooms: RoomCandidate[] = [];
    const seenRoomIds = new Set<string>();
    let scanWhere: any = whereClause;
    let scanComplete = false;
    const scanBatchSize = Math.max(100, Math.min(effectiveLimit * Math.max(effectiveDepth, 1), 500));

    // Scan newest messages in bounded batches. Since the stream is ordered by the
    // latest message in each room, the first matching room is newer than every
    // candidate still to be scanned; we can stop as soon as the requested room
    // count is reached without retaining the full bot history.
    while (selectedRooms.length < effectiveLimit && !scanComplete) {
        const batch = await prisma.message.findMany({
            where: scanWhere,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: scanBatchSize,
            select: {
                id: true,
                roomId: true,
                text: true,
                createdAt: true,
                messageType: true,
                userId: true,
                attachments: true,
                meta: true,
                tags: true,
            },
        });

        if (batch.length === 0) break;

        for (const msg of batch) {
            if (seenRoomIds.has(msg.roomId)) continue;
            seenRoomIds.add(msg.roomId);

            let matches = true;
            if (hasFilters) {
                const recentMessages = await prisma.message.findMany({
                    where: {
                        ...whereClause,
                        roomId: msg.roomId,
                    },
                    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                    take: effectiveDepth,
                    select: {
                        messageType: true,
                        meta: true,
                        tags: true,
                    },
                });

                const typeMatches = typeFilters.length === 0 || recentMessages.some(recent =>
                    typeFilters.includes(recent.messageType),
                );
                const tagMatches = tagFilters.length === 0 || recentMessages.some(recent =>
                    normalizeTagValues([recent.tags, recent.meta]).some(tag => tagFilters.includes(tag)),
                );
                matches = typeMatches && tagMatches;
            }

            if (matches) {
                selectedRooms.push({
                    roomId: msg.roomId,
                    lastMessage: msg,
                    userIds: new Set<string>(),
                });
                if (selectedRooms.length >= effectiveLimit) break;
            }
        }

        if (selectedRooms.length >= effectiveLimit || batch.length < scanBatchSize) {
            scanComplete = true;
        } else {
            const last = batch[batch.length - 1];
            // Use a composite continuation for internal batches so messages sharing
            // a timestamp are neither skipped nor fetched twice.
            scanWhere = {
                botId,
                OR: [
                    { createdAt: { lt: last.createdAt } },
                    { createdAt: last.createdAt, id: { lt: last.id } },
                ],
            };
        }
    }

    const roomIds = selectedRooms.map(room => room.roomId);

    if (roomIds.length === 0) {
        return { rooms: [] };
    }

    // Keep the existing room-user behavior without loading message rows into
    // memory: group only user IDs for the selected rooms, respecting cursor scope.
    const roomUserRows = await prisma.message.groupBy({
        by: ["roomId", "userId"],
        where: {
            ...whereClause,
            roomId: { in: roomIds },
        },
    });

    const roomUserIds = new Map<string, Set<string>>();
    for (const row of roomUserRows) {
        let userIds = roomUserIds.get(row.roomId);
        if (!userIds) {
            userIds = new Set<string>();
            roomUserIds.set(row.roomId, userIds);
        }
        userIds.add(row.userId);
    }

    const allUserIds = new Set<string>();
    for (const room of selectedRooms) {
        const userIds = roomUserIds.get(room.roomId) ?? new Set<string>();
        room.userIds = userIds;
        userIds.forEach(uid => allUserIds.add(uid));
    }

    const users = await prisma.user.findMany({
        where: {
            botId,
            userId: { in: Array.from(allUserIds) }
        },
        select: { userId: true, username: true, name: true }
    });

    const userMap = new Map(users.map(u => [u.userId, u]));

    const rooms: RoomInfo[] = selectedRooms.map(room => {
        const roomUsers = Array.from(room.userIds)
            .map(userId => userMap.get(userId))
            .filter(Boolean)
            .map(u => ({
                id: 0, // Not needed for room display
                botId,
                userId: u!.userId,
                username: u!.username,
                name: u!.name,
                createdAt: new Date(), // Not needed for room display
                blocked: false,
            })) as User[];

        return {
            botId,
            roomId: room.roomId,
            users: roomUsers,
            lastMessage: {
                id: room.lastMessage.id,
                text: room.lastMessage.text,
                createdAt: room.lastMessage.createdAt,
                messageType: room.lastMessage.messageType,
                attachments: room.lastMessage.attachments,
                meta: room.lastMessage.meta,
                tags: room.lastMessage.tags,
            } as Message,
        };
    });

    return { rooms };
}
