import axios, { type InternalAxiosRequestConfig } from "axios";

const API_KEY_STORAGE = "botoraptor_api_key";
const LEGACY_API_KEY_STORAGE = "chatlayer_api_key";
const DEFAULT_BASE = (import.meta as any).env?.VITE_API_BASE || "/";

function readStoredApiKey(): string | null {
    const primary = localStorage.getItem(API_KEY_STORAGE);
    if (primary) return primary;

    const legacy = localStorage.getItem(LEGACY_API_KEY_STORAGE);
    if (legacy) {
        localStorage.setItem(API_KEY_STORAGE, legacy);
        return legacy;
    }

    return null;
}

/**
 * Axios instance used across the app.
 * It will attach Authorization: Bearer <token> header if an API key exists in localStorage.
 */
const api = axios.create({
    baseURL: DEFAULT_BASE,
    timeout: 15000,
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const key = getApiKey();
    if (key) {
        // normalize/merge headers safely and avoid strict type issues by using a local cast
        (config.headers as any) = { ...(config.headers as any), Authorization: `Bearer ${key}` };
    }
    return config;
});

// Response interceptor: if server rejects with 401/403 treat the stored key as invalid,
// remove it and notify the application so it can show the auth prompt.
api.interceptors.response.use(
    (response) => response,
    (error: any) => {
        const status = error?.response?.status;
        if (status === 401 || status === 403) {
            try {
                // Clear stored key immediately so subsequent requests won't continuously fail
                clearApiKey();
            } catch (e) {
                // ignore storage errors
            }
            try {
                // Notify the app that authentication is required.
                // App should listen for "authRequired" and show the AuthModal.
                window.dispatchEvent(new Event("authRequired"));
            } catch (e) {
                // ignore dispatch errors
            }
        }
        return Promise.reject(error);
    }
);

/**
 * Persist / read / clear API key in localStorage
 */
export function setApiKey(key: string) {
    localStorage.setItem(API_KEY_STORAGE, key);
    localStorage.setItem(LEGACY_API_KEY_STORAGE, key);
}

export function getApiKey(): string | null {
    return readStoredApiKey();
}

export function clearApiKey() {
    localStorage.removeItem(API_KEY_STORAGE);
    localStorage.removeItem(LEGACY_API_KEY_STORAGE);
}

/**
 * Validate API key by calling a protected endpoint.
 * - The server requires botId for /getMessages, but authorization is checked earlier by server.
 * - If server returns 401 we treat key as invalid.
 * - On other responses (400, 200, etc.) we consider key accepted.
 *
 * Returns: { ok: boolean, error?: string }
 */
export async function validateApiKey(): Promise<{ ok: boolean; error?: string }> {
    try {
        // New lightweight check endpoint on the server that returns 200 when key is valid, 403 when invalid.
        await api.get("/apiKeyCheck");
        return { ok: true };
    } catch (err: any) {
        if (err?.response) {
            if (err.response.status === 403 || err.response.status === 401) {
                return { ok: false, error: "Unauthorized (invalid api key)" };
            }
            // Other 4xx/5xx responses likely indicate the server accepted the key but objected to params.
            return { ok: true };
        }
        // Network / unexpected error
        return { ok: false, error: err?.message || "Network error" };
    }
}

/**
 * getMessages
 * query params:
 *  - botId (required by server, but our wrapper leaves it optional so callers can pass filters)
 *  - roomId, limit, since (ISO), types (comma-separated)
 */
export async function getMessages(params: {
    botId?: string;
    roomId?: string;
    limit?: number;
    since?: string;
    types?: string;
}) {
    const response = await api.get("/getMessages", { params });
    return response.data;
}

/**
 * addMessage
 * body: { botId, roomId, userId, text, messageType?, attachments?, meta? }
 */
export async function addMessage(body: {
    botId: string;
    roomId: string;
    userId: string;
    text: string;
    messageType?: string;
    attachments?: any;
    meta?: any;
}) {
    const response = await api.post("/addMessage", body);
    return response.data;
}

/**
 * getUpdates - longpoll
 * params:
 *  - botIds?: string[] | string (array or comma-separated string). If omitted and listenerType=ui => listen to all bots.
 *  - botId?: string (legacy single botId)
 *  - timeoutMs?: number
 *  - listenerType?: "bot" | "ui"
 *
 * This returns whatever server returns from GET /getUpdates
 */
export async function getUpdates(params: {
    botIds?: string[] | string;
    botId?: string;
    timeoutMs?: number;
    listenerType?: "bot" | "ui";
}) {
    // normalize params for server: prefer botIds, fall back to botId for legacy callers
    const qp: any = {};
    if (params.botIds) {
        if (Array.isArray(params.botIds)) {
            qp.botIds = params.botIds.join(",");
        } else {
            qp.botIds = String(params.botIds);
        }
    } else if (params.botId) {
        qp.botId = params.botId;
    }
    if (params.timeoutMs) qp.timeoutMs = params.timeoutMs;
    if (params.listenerType) qp.listenerType = params.listenerType;
    const response = await api.get("/getUpdates", { params: qp });
    return response.data;
}
