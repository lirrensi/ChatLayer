// FILE: chatLayerSDK_node/chatLayerSDK.ts
// PURPOSE: Provide the dependency-free Node/browser SDK for authenticated Botoraptor APIs.
// OWNS: Message, room, filter-option, upload, user, and long-poll client methods.
// EXPORTS: ChatLayer, Botoraptor, and shared API data types.
// DOCS: .agents/reports/plan_multi-filter_2026-07-31.md, docs/core/server.md

// version 1.4
/**
 * ChatLayer SDK - Self-contained TypeScript library for integrating with ChatLayer server
 *
 * This SDK is designed for both Node.js and browser environments, with dual adaptations
 * for web-specific features where needed. It provides a unified API for:
 * - Message handling (sending, receiving, and managing)
 * - File uploads (single and multiple, with various source types)
 * - Real-time updates via long-polling
 * - User and bot management
 *
 * The SDK is a single file with zero dependencies, using the global fetch API.
 * It automatically normalizes server responses and handles authentication.
 *
 * Usage:
 * - Import the SDK in your project
 * - Create a ChatLayer instance with your API key and configuration
 * - Use the provided methods to interact with the ChatLayer server
 *
 * Note: This SDK is used for both client integration (Node.js apps like bots) and web apps.
 * Some methods have dual implementations for browser and Node.js environments.
 *
 * For Node.js environments, ensure @types/node is installed for proper typing.
 * In browser environments, Buffer types will be ignored as they are not available.
 *
 * Type definitions for Node.js Buffer are provided conditionally to support both environments.
 */

/**
 * Types mirrored from server Prisma schema for IDE/type-hint parity.
 * Keeping these local in the SDK file allows the SDK to be used independently.
 */
export type Attachment = {
    id?: string;
    type: "image" | "video" | "document" | "file";
    isExternal?: boolean;
    url?: string | null;
    filename?: string | null;
    original_name?: string | null;

    mime_type?: string;
    size?: number;

    createdAt?: string | null;
};

export type MessageType =
    | "user_message"
    | "user_message_service"
    | "bot_message_service"
    | "manager_message"
    | "service_call"
    | "error_message"
    | "event"
    | string;

export type Message = {
    id?: string;
    botId: string;
    roomId: string;
    userId: string;
    username?: string;
    name?: string | null;
    text?: string;
    messageType?: MessageType;
    attachments?: Attachment[] | null;
    meta?: Record<string, any> | null;
    tags?: string[] | null;
    createdAt?: string;
};

export type User = {
    id?: number;
    botId: string;
    userId: string;
    username: string;
    name?: string | null;
    createdAt?: string;
    blocked?: boolean;
};

export type ChatLayerConfig = {
    apiKey: string;
    baseUrl?: string;
    botId?: string; // optional legacy single botId
    botIds?: string[]; // optional array of botIds to listen for
    listenerType?: "bot" | "ui"; // default listener role
    timeoutMs?: number; // longpoll server timeout in ms
    onError?: (err: any) => void;
    pollDelayMs?: number; // retry delay on error
};

export type BotoraptorConfig = ChatLayerConfig;

export type RoomInfo = {
    botId: string;
    roomId: string;
    users: User[];
    lastMessage?: Message | null;
};

export type FilterOptions = {
    messageTypes: MessageType[];
    tags: string[];
};

export class ChatLayer {
    private apiKey: string;
    private baseUrl: string;
    private botId?: string; // legacy single botId
    private botIds: string[] | null = null; // current list of botIds to listen for; null => all bots
    private listenerType: "bot" | "ui" = "bot";
    private timeoutMs: number;
    private pollDelayMs: number;
    private listeners: Array<(m: Message) => void> = [];
    private running = false;
    private abort = false;
    private onError?: (err: any) => void;

    constructor(cfg: ChatLayerConfig) {
        if (!cfg || !cfg.apiKey) throw new Error("apiKey is required");
        this.apiKey = cfg.apiKey;
        this.baseUrl = (cfg.baseUrl || "/").replace(/\/+$/, "");
        this.botId = cfg.botId;
        this.botIds = cfg.botIds ?? (cfg.botId ? [cfg.botId] : null);
        this.listenerType = cfg.listenerType ?? (cfg.botIds || cfg.botId ? "bot" : "ui");
        this.timeoutMs = cfg.timeoutMs ?? 60000;
        this.pollDelayMs = cfg.pollDelayMs ?? 1000;
        this.onError = cfg.onError;
    }

    /**
     * addMessage(msg)
     * - posts the message to server /addMessage
     * - returns the created message (as returned by server)
     */
    addMessage = async (msg: Message): Promise<Message> => {
        const url = `${this.baseUrl}/api/v1/addMessage`;
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(msg),
        });

        if (!res.ok) {
            const text = await res.text().catch(() => "");
            const err = new Error(`addMessage failed: ${res.status} ${res.statusText} ${text}`);
            this.handleError(err);
            throw err;
        }

        const payload = await res.json().catch(() => null);
        if (!payload) {
            const err = new Error("addMessage: invalid json response");
            this.handleError(err);
            throw err;
        }

        if (!payload.success) {
            const err = new Error("addMessage error: " + (payload.errorMessage || JSON.stringify(payload)));
            this.handleError(err);
            throw err;
        }

        const data = this.extractResponse(payload);
        // new server returns flat key like { message: {...} } or legacy { data: <message> }
        if (data && (data as any).message) {
            const msg = (data as any).message as Message;
            this.normalizeAttachmentsInMessage(msg);
            return msg;
        }
        if (data && typeof data === "object" && !Array.isArray(data)) {
            const msg = data as Message;
            this.normalizeAttachmentsInMessage(msg);
            return msg;
        }
        const legacy = payload.data as Message;
        this.normalizeAttachmentsInMessage(legacy);
        return legacy;
    };

    /**
     * Sends a message from a manager (human operator) to the chat system.
     *
     * This is a convenience method that automatically sets the messageType to 'manager_message'
     * before sending the message to the server. Manager messages are typically used when a human
     * operator intervenes in a conversation, providing responses or instructions to users.
     *
     * @param msg - The message object containing botId, roomId, userId, and other message details
     * @returns Promise resolving to the created message object as returned by the server
     * @throws Error if the API request fails or returns an error
     *
     * @example
     * ```typescript
     * const message = await chatLayer.addManagerMessage({
     *   botId: "my-bot",
     *   roomId: "room-123",
     *   userId: "user-456",
     *   text: "Hello! I'm here to help you."
     * });
     * ```
     */
    addManagerMessage = async (msg: Message): Promise<Message> => {
        const m: Message = { ...msg, messageType: "manager_message" as MessageType };
        return this.addMessage(m);
    };
    /**
     * Sends a service alert or system notification message.
     *
     * This method sends a message with messageType set to 'service_call', which is typically
     * used for system notifications, alerts, or automated service messages that don't come
     * from users or managers but from the system itself.
     *
     * @param msg - The message object containing botId, roomId, userId, and other message details
     * @returns Promise resolving to the created message object as returned by the server
     * @throws Error if the API request fails or returns an error
     *
     * @example
     * ```typescript
     * const alert = await chatLayer.sendServiceAlert({
     *   botId: "my-bot",
     *   roomId: "room-123",
     *   userId: "system",
     *   text: "System maintenance scheduled for tonight."
     * });
     * ```
     */
    sendServiceAlert = async (msg: Message): Promise<Message> => {
        const m: Message = { ...msg, messageType: "service_call" as MessageType };
        return this.addMessage(m);
    };

    /**
     * addMessageSingle(msg, file, options)
     * - Convenience: create a message and upload a single file in the same multipart/form-data request.
     * - msg: Partial Message with required botId, roomId, userId (text/messageType optional)
     * - file: File|Blob (browser) or Buffer|Uint8Array (node)
     * - options: { type?: "image"|"video"|"document"|"file"; filename?: string; mime?: string }
     *
     * Server endpoint: POST /api/v1/addMessageSingle (multipart/form-data)
     * Form fields sent:
     *   - file: binary file
     *   - type: one of image|video|document|file (optional - server may infer)
     *   - filename: original filename hint (optional)
     *   - botId, roomId, userId, username, name, messageType, text (as strings)
     *   - meta: optional JSON string
     */
    /**
     * addMessageSingle
     * - Backwards compatible: accepts either a single file (File|Blob|Buffer|Uint8Array) or an array of such files.
     * - options can be a single options object applied to all files or an array of option objects per-file.
     * - Files are posted as multipart/form-data with repeated field name "file" and parallel "type" / "filename" fields accepted by the server.
     */
    addMessageSingle = async (
        msg: Message,
        fileOrFiles: File | Blob | Buffer | Uint8Array | Array<File | Blob | Buffer | Uint8Array>,
        options?:
            | { type?: "image" | "video" | "document" | "file"; filename?: string; mime?: string }
            | Array<{ type?: "image" | "video" | "document" | "file"; filename?: string; mime?: string }>,
    ): Promise<Message> => {
        const url = `${this.baseUrl}/api/v1/addMessageSingle`;
        if (!msg || !msg.botId || !msg.roomId || !msg.userId) {
            const err = new Error("addMessageSingle: msg.botId, msg.roomId and msg.userId are required");
            this.handleError(err);
            throw err;
        }
        if (!fileOrFiles) {
            const err = new Error("addMessageSingle: file is required");
            this.handleError(err);
            throw err;
        }

        const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
        const optsArray = Array.isArray(options) ? options : files.map(() => options || {});

        const form = new FormData();

        // message fields
        form.append("botId", msg.botId);
        form.append("roomId", msg.roomId);
        form.append("userId", msg.userId);
        if (msg.username) form.append("username", msg.username);
        if (msg.name) form.append("name", String(msg.name));
        if (msg.messageType) form.append("messageType", String(msg.messageType));
        if (msg.text) form.append("text", String(msg.text));
        if (msg.meta !== undefined && msg.meta !== null) {
            try {
                form.append("meta", typeof msg.meta === "string" ? msg.meta : JSON.stringify(msg.meta));
            } catch {
                form.append("meta", String(msg.meta));
            }
        }

        // attach each file and corresponding type/filename (server expects repeated fields)
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const opt = optsArray[i] || {};
            const filename = opt.filename || ((f as any).name as string) || `file_${i}`;
            // append type and filename as separate fields so server can read type[] / filename[]
            if (opt.type) form.append("type", opt.type);
            form.append("filename", filename);

            // append the file itself
            try {
                if (typeof Blob !== "undefined" && (f instanceof Blob || (f as any).arrayBuffer)) {
                    form.append("file", f as any, filename);
                } else {
                    try {
                        if (typeof Blob !== "undefined") {
                            const blob = new Blob([f as any], { type: opt.mime || "application/octet-stream" });
                            form.append("file", blob as any, filename);
                        } else {
                            // attempt append Buffer directly
                            form.append("file", f as any, filename);
                        }
                    } catch {
                        form.append("file", f as any);
                    }
                }
            } catch (e) {
                // final fallback
                try {
                    form.append("file", f as any);
                } catch (err) {
                    const e2 = new Error("addMessageSingle: failed to append file to form data");
                    this.handleError(e2);
                    throw e2;
                }
            }
        }

        const res = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
            } as any,
            body: form as any,
        });

        if (!res.ok) {
            const text = await res.text().catch(() => "");
            const err = new Error(`addMessageSingle failed: ${res.status} ${res.statusText} ${text}`);
            this.handleError(err);
            throw err;
        }

        const payload = await res.json().catch(() => null);
        if (!payload) {
            const err = new Error("addMessageSingle: invalid json response");
            this.handleError(err);
            throw err;
        }
        if (!payload.success) {
            const err = new Error("addMessageSingle error: " + (payload.errorMessage || JSON.stringify(payload)));
            this.handleError(err);
            throw err;
        }

        const data = this.extractResponse(payload);
        if (data && (data as any).message) {
            const msg = (data as any).message as Message;
            this.normalizeAttachmentsInMessage(msg);
            return msg;
        }
        if (data && typeof data === "object" && !Array.isArray(data)) {
            const msg = data as Message;
            this.normalizeAttachmentsInMessage(msg);
            return msg;
        }
        const legacy = payload.data as Message;
        this.normalizeAttachmentsInMessage(legacy);
        return legacy;
    };

    /**
     * addUser(user)
     * - posts to /addUser and returns created or existing user
     */
    addUser = async (user: {
        botId: string;
        userId: string;
        username?: string;
        name?: string | null;
    }): Promise<User> => {
        const url = `${this.baseUrl}/api/v1/addUser`;
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(user),
        });

        if (!res.ok) {
            const text = await res.text().catch(() => "");
            const err = new Error(`addUser failed: ${res.status} ${res.statusText} ${text}`);
            this.handleError(err);
            throw err;
        }

        const payload = await res.json().catch(() => null);
        if (!payload) {
            const err = new Error("addUser: invalid json response");
            this.handleError(err);
            throw err;
        }

        if (!payload.success) {
            const err = new Error("addUser error: " + (payload.errorMessage || JSON.stringify(payload)));
            this.handleError(err);
            throw err;
        }

        const data = this.extractResponse(payload);
        if (data && (data as any).user) return (data as any).user as User;
        if (data && typeof data === "object" && !Array.isArray(data)) return data as User;
        return payload.data as User;
    };

    /**
     * getMessages(params)
     * - wrapper for GET /getMessages
     * - server returns newest-first (createdAt desc)
     * - server default limit is 20 when not provided
     * - use cursorId to paginate older messages (cursorId = message.id of the last item you have)
     * - optional multi-value message type and tag filtering. Values within each
     *   group are ORed; the two groups are ANDed when both are set.
     */
    getMessages = async (params: {
        botId?: string;
        roomId?: string;
        limit?: number;
        cursorId?: number | string;
        types?: string;
        tags?: string[] | string;
    }): Promise<Message[]> => {
        const botId = params.botId ?? this.botId;
        if (!botId) throw new Error("botId is required for getMessages (provide in params or constructor)");
        const qp = new URLSearchParams();
        qp.set("botId", botId);
        if (params.roomId) qp.set("roomId", params.roomId);
        if (params.limit) qp.set("limit", String(params.limit));
        if (params.cursorId !== undefined && params.cursorId !== null) qp.set("cursorId", String(params.cursorId));
        if (params.types) qp.set("types", params.types);
        if (params.tags) {
            const values = Array.isArray(params.tags) ? params.tags : [params.tags];
            const normalized = values.map(String).map(value => value.trim()).filter(Boolean);
            if (normalized.length > 0) qp.set("tags", normalized.join(","));
        }
        const url = `${this.baseUrl}/api/v1/getMessages?${qp.toString()}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${this.apiKey}` } });
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            const err = new Error(`getMessages failed: ${res.status} ${res.statusText} ${text}`);
            this.handleError(err);
            throw err;
        }
        const payload = await res.json().catch(() => null);
        if (!payload) {
            const err = new Error("getMessages: invalid json response");
            this.handleError(err);
            throw err;
        }
        if (!payload.success) {
            const err = new Error("getMessages error: " + (payload.errorMessage || JSON.stringify(payload)));
            this.handleError(err);
            throw err;
        }

        const data = this.extractResponse(payload);
        let rows: Message[] = [];
        if (Array.isArray(data)) rows = data as Message[];
        else if (data && Array.isArray((data as any).messages)) rows = (data as any).messages as Message[];
        else if (Array.isArray(payload.data)) rows = payload.data as Message[];
        else {
            const err = new Error("getMessages: unexpected payload shape");
            this.handleError(err);
            throw err;
        }

        // normalize attachment urls on returned messages
        this.normalizeAttachmentsInMessagesArray(rows);
        return rows;
    };

    /**
     * getBots()
     * - GET /getBots
     * - returns an array of botId strings
     */
    getBots = async (): Promise<string[]> => {
        const url = `${this.baseUrl}/api/v1/getBots`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${this.apiKey}` } });
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            const err = new Error(`getBots failed: ${res.status} ${res.statusText} ${text}`);
            this.handleError(err);
            throw err;
        }

        const payload = await res.json().catch(() => null);
        if (!payload) {
            const err = new Error("getBots: invalid json response");
            this.handleError(err);
            throw err;
        }

        if (!payload.success) {
            const err = new Error("getBots error: " + (payload.errorMessage || JSON.stringify(payload)));
            this.handleError(err);
            throw err;
        }

        const data = this.extractResponse(payload);
        if (Array.isArray(data)) return data as string[];
        if (data && Array.isArray((data as any).bots)) return (data as any).bots as string[];
        if (payload.data && Array.isArray((payload.data as any).bots)) return payload.data.bots as string[];

        const err = new Error("getBots: unexpected payload shape");
        this.handleError(err);
        throw err;
    };

    /**
     * getFilterOptions()
     * - GET /getFilterOptions
     * - returns distinct message types and normalized tags from the complete database
     */
    getFilterOptions = async (): Promise<FilterOptions> => {
        const url = `${this.baseUrl}/api/v1/getFilterOptions`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${this.apiKey}` } });
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            const err = new Error(`getFilterOptions failed: ${res.status} ${res.statusText} ${text}`);
            this.handleError(err);
            throw err;
        }

        const payload = await res.json().catch(() => null);
        if (!payload) {
            const err = new Error("getFilterOptions: invalid json response");
            this.handleError(err);
            throw err;
        }
        if (!payload.success) {
            const err = new Error("getFilterOptions error: " + (payload.errorMessage || JSON.stringify(payload)));
            this.handleError(err);
            throw err;
        }

        const data = this.extractResponse(payload);
        if (!data || !Array.isArray(data.messageTypes) || !Array.isArray(data.tags)) {
            const err = new Error("getFilterOptions: unexpected payload shape");
            this.handleError(err);
            throw err;
        }

        return {
            messageTypes: data.messageTypes.map(String),
            tags: data.tags.map(String),
        };
    };

    /**
     * getRooms(params)
     * - wrapper for GET /getRooms
     * - Optional multi-value message type and tag filtering with a per-room depth check.
     *   Values within each group are ORed; the two groups are ANDed when both are set.
     */
    getRooms = async (params?: {
        botId?: string;
        messageType?: MessageType;
        messageTypes?: MessageType[] | string;
        depth?: number;
        tags?: string[] | string;
    }): Promise<{ rooms: RoomInfo[] }> => {
        const botId = params?.botId ?? this.botId;
        if (!botId) throw new Error("botId is required for getRooms (provide in params or constructor)");
        const qp = new URLSearchParams();
        qp.set("botId", botId);
        if (params?.messageType) qp.set("messageType", String(params.messageType));
        if (params?.messageTypes) {
            const values = Array.isArray(params.messageTypes) ? params.messageTypes : [params.messageTypes];
            const normalized = values.map(String).map(value => value.trim()).filter(Boolean);
            if (normalized.length > 0) qp.set("messageTypes", normalized.join(","));
        }
        if (params?.depth !== undefined && params.depth > 0) qp.set("depth", String(params.depth));
        if (params?.tags) {
            const values = Array.isArray(params.tags) ? params.tags : [params.tags];
            const normalized = values.map(String).map(value => value.trim()).filter(Boolean);
            if (normalized.length > 0) qp.set("tags", normalized.join(","));
        }
        const url = `${this.baseUrl}/api/v1/getRooms?${qp.toString()}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${this.apiKey}` } });
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            const err = new Error(`getRooms failed: ${res.status} ${res.statusText} ${text}`);
            this.handleError(err);
            throw err;
        }
        const payload = await res.json().catch(() => null);
        if (!payload) {
            const err = new Error("getRooms: invalid json response");
            this.handleError(err);
            throw err;
        }
        if (!payload.success) {
            const err = new Error("getRooms error: " + (payload.errorMessage || JSON.stringify(payload)));
            this.handleError(err);
            throw err;
        }

        const data = this.extractResponse(payload);
        let result: { rooms: RoomInfo[] } | null = null;
        if (data && Array.isArray((data as any).rooms)) result = data as { rooms: RoomInfo[] };
        else if (payload.data && Array.isArray((payload.data as any).rooms))
            result = payload.data as { rooms: RoomInfo[] };

        if (!result) {
            const err = new Error("getRooms: unexpected payload shape");
            this.handleError(err);
            throw err;
        }

        // normalize attachment urls in lastMessage for each room
        if (result.rooms) {
            for (const room of result.rooms) {
                if (room.lastMessage) {
                    this.normalizeAttachmentsInMessage(room.lastMessage);
                }
            }
        }

        return result;
    };

    /**
     * getClientConfig()
     * - GET /getClientConfig
     * - returns the client configuration object from client_config.json
     */
    getClientConfig = async (): Promise<Record<string, any>> => {
        const url = `${this.baseUrl}/api/v1/getClientConfig`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${this.apiKey}` } });
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            const err = new Error(`getClientConfig failed: ${res.status} ${res.statusText} ${text}`);
            this.handleError(err);
            throw err;
        }

        const payload = await res.json().catch(() => null);
        if (!payload) {
            const err = new Error("getClientConfig: invalid json response");
            this.handleError(err);
            throw err;
        }

        if (!payload.success) {
            const err = new Error("getClientConfig error: " + (payload.errorMessage || JSON.stringify(payload)));
            this.handleError(err);
            throw err;
        }

        const data = this.extractResponse(payload);
        if (data && typeof data === "object" && !Array.isArray(data)) {
            return data as Record<string, any>;
        }

        const err = new Error("getClientConfig: unexpected payload shape");
        this.handleError(err);
        throw err;
    };

    /**
     * Uploads files from browser/web environments using File or Blob objects.
     *
     * This method is specifically designed for browser usage where files are typically
     * obtained from file input elements or drag-and-drop operations. It accepts File objects
     * (from input[type="file"]) or Blob objects and uploads them as multipart/form-data.
     *
     * Supports both single file uploads and batch uploads with arrays. Each file can have
     * individual options for type classification and filename override.
     *
     * @param fileOrFiles - Single File/Blob or array of File/Blob objects to upload
     * @param options - Upload options for each file. Can be a single options object (applied to all files)
     *                 or an array of options objects (one per file)
     * @param options[].type - Required file type classification: "image", "video", "document", or "file"
     * @param options[].filename - Optional filename override (defaults to file.name if available)
     * @returns Promise resolving to array of Attachment objects representing the uploaded files
     * @throws Error if upload fails or required parameters are missing
     *
     * @example
     * ```typescript
     * // Single file upload
     * const fileInput = document.getElementById('file-input') as HTMLInputElement;
     * const file = fileInput.files[0];
     * const attachments = await chatLayer.uploadFileWeb(file, {
     *   type: "image",
     *   filename: "user-upload.jpg"
     * });
     *
     * // Multiple files upload
     * const files = Array.from(fileInput.files);
     * const attachments = await chatLayer.uploadFileWeb(files, [
     *   { type: "image", filename: "photo1.jpg" },
     *   { type: "document", filename: "doc.pdf" }
     * ]);
     * ```
     */
    uploadFileWeb = async (
        fileOrFiles: File | Blob | Array<File | Blob>,
        options?:
            | { type: "image" | "video" | "document" | "file"; filename?: string }
            | Array<{ type: "image" | "video" | "document" | "file"; filename?: string }>,
    ): Promise<Attachment[]> => {
        const url = `${this.baseUrl}/api/v1/uploadFile`;
        if (!fileOrFiles) {
            const err = new Error("uploadFileWeb: file is required");
            this.handleError(err);
            throw err;
        }
        const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
        const optsArray = Array.isArray(options) ? options : files.map(() => options || ({} as any));

        const form = new FormData();
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const opt = optsArray[i] || ({} as any);
            const filename = opt.filename || ((file as any).name as string) || `file_${i}`;
            if (opt.type) form.append("type", opt.type);
            form.append("filename", filename);
            form.append("file", file as any, filename);
        }

        const res = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
            } as any,
            body: form as any,
        });

        if (!res.ok) {
            const text = await res.text().catch(() => "");
            const err = new Error(`uploadFileWeb failed: ${res.status} ${res.statusText} ${text}`);
            this.handleError(err);
            throw err;
        }

        const payload = await res.json().catch(() => null);
        if (!payload) {
            const err = new Error("uploadFileWeb: invalid json response");
            this.handleError(err);
            throw err;
        }
        if (!payload.success) {
            const err = new Error("uploadFileWeb error: " + (payload.errorMessage || JSON.stringify(payload)));
            this.handleError(err);
            throw err;
        }

        const data = this.extractResponse(payload);
        let atts: Attachment[] = [];
        if (Array.isArray(data)) atts = data as Attachment[];
        else if (data && Array.isArray((data as any).attachments)) atts = (data as any).attachments as Attachment[];
        else if (payload.data && Array.isArray((payload.data as any).attachments))
            atts = payload.data.attachments as Attachment[];

        // normalize returned attachment urls
        for (const a of atts) {
            if (a && a.url && typeof a.url === "string") {
                a.url = this.ensureAbsoluteUrl(a.url) as string;
            }
        }

        return atts;
    };

    /**
     * Uploads files from Node.js environments using Buffer or Uint8Array objects.
     *
     * This method is designed for server-side Node.js usage where files are typically
     * read from disk, received from streams, or generated programmatically. It accepts
     * Buffer objects (from fs.readFile) or Uint8Array objects and uploads them as
     * multipart/form-data, automatically creating Blob objects when available.
     *
     * Supports both single buffer uploads and batch uploads with arrays. Each buffer
     * requires explicit type and filename options since they don't have inherent metadata.
     *
     * @param bufferOrBuffers - Single Buffer/Uint8Array or array of Buffer/Uint8Array objects to upload
     * @param options - Upload options for each buffer. Can be a single options object (applied to all buffers)
     *                 or an array of options objects (one per buffer)
     * @param options[].type - Required file type classification: "image", "video", "document", or "file"
     * @param options[].filename - Required filename for the uploaded file
     * @param options[].mime - Optional MIME type (defaults to "application/octet-stream")
     * @returns Promise resolving to array of Attachment objects representing the uploaded files
     * @throws Error if upload fails, required parameters are missing, or buffer creation fails
     *
     * @example
     * ```typescript
     * import { readFileSync } from 'fs';
     *
     * // Single buffer upload
     * const buffer = readFileSync('image.jpg');
     * const attachments = await chatLayer.uploadFileBuffer(buffer, {
     *   type: "image",
     *   filename: "uploaded-image.jpg",
     *   mime: "image/jpeg"
     * });
     *
     * // Multiple buffers upload
     * const buffers = [
     *   readFileSync('photo1.jpg'),
     *   readFileSync('document.pdf')
     * ];
     * const attachments = await chatLayer.uploadFileBuffer(buffers, [
     *   { type: "image", filename: "photo1.jpg", mime: "image/jpeg" },
     *   { type: "document", filename: "document.pdf", mime: "application/pdf" }
     * ]);
     * ```
     */
    uploadFileBuffer = async (
        bufferOrBuffers: Buffer | Uint8Array | Array<Buffer | Uint8Array>,
        options?:
            | { type: "image" | "video" | "document" | "file"; filename: string; mime?: string }
            | Array<{ type: "image" | "video" | "document" | "file"; filename: string; mime?: string }>,
    ): Promise<Attachment[]> => {
        const url = `${this.baseUrl}/api/v1/uploadFile`;
        if (!bufferOrBuffers) {
            const err = new Error("uploadFileBuffer: buffer is required");
            this.handleError(err);
            throw err;
        }
        const buffers = Array.isArray(bufferOrBuffers) ? bufferOrBuffers : [bufferOrBuffers];
        const optsArray = Array.isArray(options) ? options : buffers.map(() => options || ({} as any));

        const form = new FormData();
        for (let i = 0; i < buffers.length; i++) {
            const buf = buffers[i];
            const opt = optsArray[i] || ({} as any);
            if (!opt || !opt.filename || !opt.type) {
                const err = new Error("uploadFileBuffer: each file requires options.type and options.filename");
                this.handleError(err);
                throw err;
            }
            const filename = opt.filename;
            // Try to append a Blob if available, otherwise append buffer directly
            try {
                if (typeof Blob !== "undefined") {
                    const blob = new Blob([buf as any], { type: opt.mime || "application/octet-stream" });
                    form.append("file", blob as any, filename);
                } else {
                    try {
                        form.append("file", buf as any, filename);
                    } catch {
                        form.append(
                            "file",
                            buf as any,
                            { filename, contentType: opt.mime || "application/octet-stream" } as any,
                        );
                    }
                }
            } catch (e) {
                try {
                    form.append("file", buf as any);
                } catch (err) {
                    const e2 = new Error("uploadFileBuffer: failed to create form data for buffer");
                    this.handleError(e2);
                    throw e2;
                }
            }
            form.append("type", opt.type);
            form.append("filename", filename);
        }

        const res = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
            } as any,
            body: form as any,
        });

        if (!res.ok) {
            const text = await res.text().catch(() => "");
            const err = new Error(`uploadFileBuffer failed: ${res.status} ${res.statusText} ${text}`);
            this.handleError(err);
            throw err;
        }

        const payload = await res.json().catch(() => null);
        if (!payload) {
            const err = new Error("uploadFileBuffer: invalid json response");
            this.handleError(err);
            throw err;
        }
        if (!payload.success) {
            const err = new Error("uploadFileBuffer error: " + (payload.errorMessage || JSON.stringify(payload)));
            this.handleError(err);
            throw err;
        }

        const data = this.extractResponse(payload);
        let atts: Attachment[] = [];
        if (Array.isArray(data)) atts = data as Attachment[];
        else if (data && Array.isArray((data as any).attachments)) atts = (data as any).attachments as Attachment[];
        else if (payload.data && Array.isArray((payload.data as any).attachments))
            atts = payload.data.attachments as Attachment[];

        // normalize returned attachment urls
        for (const a of atts) {
            if (a && a.url && typeof a.url === "string") {
                a.url = this.ensureAbsoluteUrl(a.url) as string;
            }
        }

        return atts;
    };

    /**
     * Downloads and uploads files from remote URLs.
     *
     * This method allows uploading files by providing their URLs instead of file data.
     * The server will download the files from the provided URLs and store them locally.
     * This is useful for importing files from external sources or when you have URLs
     * but not the actual file data.
     *
     * Each file object can optionally specify a filename and type. If not provided,
     * the server will attempt to infer them from the URL and content.
     *
     * @param files - Array of file objects, each containing a URL and optional metadata
     * @param files[].url - Required URL of the file to download and upload
     * @param files[].filename - Optional filename override for the uploaded file
     * @param files[].type - Optional file type classification: "image", "video", "document", or "file"
     * @returns Promise resolving to array of Attachment objects representing the uploaded files
     * @throws Error if upload fails, URLs are invalid, or files array is empty
     *
     * @example
     * ```typescript
     * const attachments = await chatLayer.uploadFileByURL([
     *   {
     *     url: "https://example.com/image.jpg",
     *     filename: "downloaded-image.jpg",
     *     type: "image"
     *   },
     *   {
     *     url: "https://example.com/document.pdf",
     *     type: "document"
     *   }
     * ]);
     * ```
     */
    uploadFileByURL = async (
        files: Array<{ url: string; filename?: string; type?: "image" | "video" | "document" | "file" }>,
    ): Promise<Attachment[]> => {
        const url = `${this.baseUrl}/api/v1/uploadFileByURL`;
        if (!files || !Array.isArray(files) || files.length === 0) {
            const err = new Error("uploadFileByURL: files array is required");
            this.handleError(err);
            throw err;
        }

        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`,
            } as any,
            body: JSON.stringify({ files }),
        });

        if (!res.ok) {
            const text = await res.text().catch(() => "");
            const err = new Error(`uploadFileByURL failed: ${res.status} ${res.statusText} ${text}`);
            this.handleError(err);
            throw err;
        }

        const payload = await res.json().catch(() => null);
        if (!payload) {
            const err = new Error("uploadFileByURL: invalid json response");
            this.handleError(err);
            throw err;
        }
        if (!payload.success) {
            const err = new Error("uploadFileByURL error: " + (payload.errorMessage || JSON.stringify(payload)));
            this.handleError(err);
            throw err;
        }

        const data = this.extractResponse(payload);
        let atts: Attachment[] = [];
        if (Array.isArray(data)) atts = data as Attachment[];
        else if (data && Array.isArray((data as any).attachments)) atts = (data as any).attachments as Attachment[];
        else if (payload.data && Array.isArray((payload.data as any).attachments))
            atts = payload.data.attachments as Attachment[];

        // normalize returned attachment urls
        for (const a of atts) {
            if (a && a.url && typeof a.url === "string") {
                a.url = this.ensureAbsoluteUrl(a.url) as string;
            }
        }

        return atts;
    };

    /**
     * onMessage(callback)
     * - register a callback that will be invoked for each incoming Message
     * - returns an unsubscribe function
     */
    onMessage = (cb: (m: Message) => void): (() => void) => {
        this.listeners.push(cb);
        return () => {
            this.listeners = this.listeners.filter(c => c !== cb);
        };
    };

    /**
     * Starts the real-time message polling loop using long-polling.
     *
     * This method initiates a continuous polling loop that listens for new messages
     * and other updates from the ChatLayer server. When new messages arrive, they
     * are automatically delivered to all registered listeners via the onMessage callback.
     *
     * The polling uses exponential backoff on errors and includes automatic reconnection.
     * The loop can be stopped by calling the stop() method.
     *
     * @param opts - Optional configuration overrides for this polling session
     * @param opts.botIds - Array of bot IDs to listen for (null for all bots). Overrides constructor setting.
     * @param opts.listenerType - Listener role: "bot" (for bot integrations) or "ui" (for UI clients). Overrides constructor setting.
     * @throws Error if botIds are required but not provided for listenerType="bot"
     *
     * @example
     * ```typescript
     * // Start listening for all bots (UI mode)
     * chatLayer.start();
     *
     * // Start listening for specific bots (bot mode)
     * chatLayer.start({
     *   botIds: ["bot-1", "bot-2"],
     *   listenerType: "bot"
     * });
     *
     * // Register a message handler before starting
     * chatLayer.onMessage((message) => {
     *   console.log('New message:', message);
     * });
     * chatLayer.start();
     * ```
     */
    start = (opts?: { botIds?: string[] | null; listenerType?: "bot" | "ui" }): void => {
        if (this.running) return;
        const runBotIds = opts?.botIds ?? this.botIds ?? null;
        const runListenerType = opts?.listenerType ?? this.listenerType ?? "bot";
        if (runListenerType === "bot" && (!runBotIds || runBotIds.length === 0)) {
            throw new Error(
                "botIds are required to start longpolling for listenerType=bot. Provide them in constructor or start()",
            );
        }
        this.botIds = runBotIds;
        this.listenerType = runListenerType;
        this.running = true;
        this.abort = false;
        void this.pollLoop(this.botIds, this.listenerType);
    };

    /**
     * Stops the real-time message polling loop.
     *
     * This method gracefully terminates the long-polling loop started by start().
     * Any ongoing polling request will be aborted, and no new polling requests will be made.
     * Registered message listeners remain active and can be reused if start() is called again.
     *
     * @example
     * ```typescript
     * // Start polling
     * chatLayer.start();
     *
     * // Later, stop polling
     * chatLayer.stop();
     * ```
     */
    stop = (): void => {
        this.abort = true;
        this.running = false;
    };

    private async pollLoop(botIds: string[] | null, listenerType: "bot" | "ui"): Promise<void> {
        let backoff = this.pollDelayMs;
        while (!this.abort) {
            try {
                const updates = await this.fetchUpdates(botIds);
                backoff = this.pollDelayMs; // reset backoff on success
                if (Array.isArray(updates) && updates.length > 0) {
                    for (const m of updates) {
                        try {
                            this.listeners.forEach(cb => {
                                try {
                                    cb(m);
                                } catch (e) {
                                    /* swallow listener errors */
                                }
                            });
                        } catch (e) {
                            /* noop */
                        }
                    }
                }
                // small pause before immediately polling again so loop is cooperative
                await this.sleep(50);
            } catch (err) {
                this.handleError(err);
                // exponential backoff up to 30s
                await this.sleep(backoff);
                backoff = Math.min(30000, backoff * 1.5);
            }
        }
    }

    private async fetchUpdates(botIds: string[] | null): Promise<Message[]> {
        const params = new URLSearchParams();
        if (botIds && botIds.length > 0) {
            params.set("botIds", botIds.join(","));
        }
        params.set("timeoutMs", String(this.timeoutMs));
        params.set("listenerType", this.listenerType);
        const url = `${this.baseUrl}/api/v1/getUpdates?${params.toString()}`;

        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
            },
        });

        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(`getUpdates failed: ${res.status} ${res.statusText} ${text}`);
        }

        const payload = await res.json().catch(() => null);
        if (!payload) throw new Error("getUpdates: invalid json response");
        if (!payload.success) {
            throw new Error("getUpdates error: " + (payload.errorMessage || JSON.stringify(payload)));
        }

        const data = this.extractResponse(payload);
        let rows: Message[] = [];
        if (Array.isArray(data)) rows = data as Message[];
        else if (data && Array.isArray((data as any).messages)) rows = (data as any).messages as Message[];
        else if (Array.isArray(payload.data)) rows = payload.data as Message[];
        else return [];

        // normalize attachment urls
        this.normalizeAttachmentsInMessagesArray(rows);
        return rows;
    }

    private extractResponse(payload: any): any {
        // If server used legacy { data: ... } shape, return that.
        if (!payload) return null;
        if (payload.data !== undefined) return payload.data;
        // Otherwise remove metadata fields and return the remaining top-level keys.
        const { success, errorMessage, ...rest } = payload;
        if (Object.keys(rest).length === 0) return null;
        return rest;
    }

    // Normalize attachment URLs returned by the server:
    // - If attachment.url is a relative path (starts with '/'), prefix with the configured baseUrl.
    // - If attachment.url is already absolute (http/https) leave it unchanged.
    // This ensures SDK consumers can use attachment.url directly to fetch the file.
    private ensureAbsoluteUrl(u: string | undefined | null): string | undefined | null {
        if (!u) return u;
        try {
            if (/^https?:\/\//i.test(u)) return u;
            // baseUrl stored without trailing slash; ensure single slash between baseUrl and path
            return this.baseUrl + (u.startsWith("/") ? u : `/${u}`);
        } catch {
            return u;
        }
    }

    private normalizeAttachmentsInMessage(msg: any): void {
        if (!msg || !Array.isArray(msg.attachments)) return;
        for (const a of msg.attachments) {
            if (a && a.url && typeof a.url === "string") {
                a.url = this.ensureAbsoluteUrl(a.url) as string;
            }
        }
    }

    private normalizeAttachmentsInMessagesArray(arr: any[]): void {
        if (!Array.isArray(arr)) return;
        for (const m of arr) {
            this.normalizeAttachmentsInMessage(m);
        }
    }

    private sleep(ms: number) {
        return new Promise(r => setTimeout(r, ms));
    }

    private handleError(err: any) {
        try {
            if (this.onError) this.onError(err);
        } catch (e) {
            // ignore
        }
        // also emit to console for visibility
        try {
            console.error("[Botoraptor SDK] error:", err);
        } catch { }
    }
}

export { ChatLayer as Botoraptor };
export default ChatLayer;
