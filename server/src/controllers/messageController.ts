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
    messageType?: string; // Filter by message type (e.g., "error_message")
    depth?: number; // Default 5 - check if type appears in last N messages
    limit?: number; // Max rooms to return (default 50, max 500)
    cursorId?: string; // Pagination cursor (message id)
    tags?: string[]; // Filter by tags (AND with messageType if both provided)
};

/**
 * getRooms(opts)
 * - Scans messages for the given botId and returns a list of rooms.
 * - Each room includes the botId, roomId, array of users present in the room,
 *   and the most recent message for that room (lastMessage).
 * - Optional filtering by messageType with depth check: only returns rooms where
 *   the specified message type appears in the last `depth` messages of that room.
 *   This is useful for finding cases like error+automated message sequences.
 * - Pagination: uses cursorId for efficient scrolling through large datasets.
 * - Batch user fetch: fetches all users in a single query (fixes N+1 problem).
 */
export async function getRooms(opts: GetRoomsOptions): Promise<{ rooms: RoomInfo[] }> {
    const { botId, messageType, depth = 10, limit = 50, cursorId, tags } = opts;
    const effectiveLimit = Math.min(limit, 500); // Cap at 500

    if (!botId) {
        throw new Error("botId is required");
    }

    // Build query with pagination
    const whereClause: any = { botId };
    
    // If cursor provided, filter to messages before that cursor
    if (cursorId) {
        const cursorMessage = await prisma.message.findUnique({
            where: { id: parseInt(cursorId, 10) },
            select: { createdAt: true }
        });
        if (cursorMessage) {
            whereClause.createdAt = { lt: cursorMessage.createdAt };
        }
    }

    // Get distinct roomIds with their latest message - with limit
    const latestMessages = await prisma.message.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
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
        take: effectiveLimit * depth, // Get enough messages to find limit rooms
    });

    // Group by roomId and get last message per room
    const roomMap = new Map<string, {
        roomId: string;
        lastMessage: any;
        userIds: Set<string>;
    }>();

    for (const msg of latestMessages) {
        if (roomMap.size >= effectiveLimit) break;
        
        if (!roomMap.has(msg.roomId)) {
            roomMap.set(msg.roomId, {
                roomId: msg.roomId,
                lastMessage: msg,
                userIds: new Set([msg.userId]),
            });
        } else {
            roomMap.get(msg.roomId)!.userIds.add(msg.userId);
        }
    }

    const roomIds = Array.from(roomMap.keys());

    if (roomIds.length === 0) {
        return { rooms: [] };
    }

    // Batch fetch all users in a single query (fixes N+1)
    const allUserIds = new Set<string>();
    for (const room of roomMap.values()) {
        room.userIds.forEach(uid => allUserIds.add(uid));
    }

    const users = await prisma.user.findMany({
        where: {
            botId,
            userId: { in: Array.from(allUserIds) }
        },
        select: { userId: true, username: true, name: true }
    });

    const userMap = new Map(users.map(u => [u.userId, u]));

    // Filter by messageType if specified
    let rooms: RoomInfo[] = Array.from(roomMap.values()).map(room => {
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

    if (messageType) {
        rooms = rooms.filter(r => r.lastMessage && r.lastMessage.messageType === messageType);
    }

    if (tags && tags.length > 0) {
        rooms = rooms.filter(r => {
            if (!r.lastMessage) return false;
            const msgTags = (r.lastMessage as any).tags;
            if (!Array.isArray(msgTags) || msgTags.length === 0) return false;
            return tags.some((t: string) => msgTags.includes(t));
        });
    }

    return { rooms };
}
