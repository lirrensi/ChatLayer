// FILE: apps/web/src/stores/uiStore.ts
// PURPOSE: Own the chat workspace state and normalize API data before rendering.
// OWNS: Bot, room, message, filter-option, cache, and listener state for the web UI.
// EXPORTS: useUiStore, normalizeTags — workspace store and resilient tag normalizer.
// DOCS: .agents/reports/plan_multi-filter_2026-07-31.md, docs/core/web-ui.md

import { defineStore } from "pinia";
import { ref, computed, watch } from "vue";
import { IonButton, toastController } from "@ionic/vue";
import { Botoraptor, type FilterOptions, type Message, type RoomInfo } from "../../../../sdk-templates/node/botoraptor.ts";
import { getApiKey as getStoredApiKey } from "../services/api";
import { t } from "../i18n";
import localforage from "localforage";
import { notificationManager } from "../helpers/notificationManager";

/**
 * Convert the tag shapes used by older and newer API responses into display-safe labels.
 * The server contract remains untouched: this is deliberately a UI boundary normalizer.
 */
export function normalizeTags(value: unknown): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    const visit = (input: unknown, depth = 0): void => {
        if (input == null || depth > 4) return;

        if (Array.isArray(input)) {
            input.forEach(item => visit(item, depth + 1));
            return;
        }

        if (typeof input === "string") {
            const text = input.trim();
            if (!text) return;

            // Some deployments return JSON-encoded arrays/objects in a string column.
            if ((text.startsWith("[") && text.endsWith("]")) || (text.startsWith("{") && text.endsWith("}"))) {
                try {
                    visit(JSON.parse(text), depth + 1);
                    return;
                } catch {
                    // Treat malformed JSON as a normal tag value below.
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

        if (typeof input === "object") {
            const record = input as Record<string, unknown>;
            if ("tags" in record) visit(record.tags, depth + 1);
            else if ("tag" in record) visit(record.tag, depth + 1);
            else {
                ["meta", "metadata", "data", "message", "lastMessage"].forEach(key => {
                    if (key in record) visit(record[key], depth + 1);
                });
            }
        }
    };

    visit(value);
    return result;
}

/** Read tags from the common top-level and metadata envelopes without changing API data. */
export function getEntityTags(entity: unknown): string[] {
    if (!entity || typeof entity !== "object") return [];
    const record = entity as Record<string, unknown>;
    return normalizeTags([
        record.tags,
        record.tag,
        record.meta,
        record.metadata,
        record.data,
        record.message,
        record.lastMessage,
    ]);
}

function normalizeStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
        return Array.from(new Set(value.map(item => String(item).trim()).filter(Boolean)));
    }
    if (typeof value === "string") {
        return Array.from(new Set(value.split(",").map(item => item.trim()).filter(Boolean)));
    }
    return [];
}

function normalizeRoomFilter(value: unknown): {
    messageTypes: string[];
    depth: number;
    tags: string[];
} {
    const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const legacyMessageType = typeof record.messageType === "string" ? record.messageType : undefined;
    const messageTypes = normalizeStringArray(record.messageTypes);
    if (messageTypes.length === 0 && legacyMessageType) messageTypes.push(...normalizeStringArray(legacyMessageType));

    const rawDepth = Number(record.depth);
    const depth = Number.isFinite(rawDepth) ? Math.min(10, Math.max(1, rawDepth)) : 5;
    return {
        messageTypes,
        depth,
        tags: normalizeStringArray(record.tags),
    };
}

function normalizeMessageFilter(value: unknown): {
    messageTypes: string[];
    tags: string[];
} {
    const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return {
        messageTypes: normalizeStringArray(record.messageTypes),
        tags: normalizeStringArray(record.tags),
    };
}

function normalizeFilterOptions(value: unknown): FilterOptions {
    const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return {
        messageTypes: normalizeStringArray(record.messageTypes),
        tags: normalizeStringArray(record.tags),
    };
}

/**
 * UI Store
 * - Holds global UI state: bots, rooms, messages, selected botId / roomId
 * - Exposes loaders: loadBots -> auto-select first bot -> loadRooms(botId)
 * - Exposes room/message loaders and a global long-poll listener (UI role)
 *
 * Usage:
 *  const ui = useUiStore();
 *  ui.init(); // start listener and load initial data
 */

export const useUiStore = defineStore("ui", () => {
    const bots = ref<string[]>([]);
    const rooms = ref<RoomInfo[]>([]);
    const messages = ref<Message[]>([]);
const selectedBotId = ref<string | undefined>(undefined);
const selectedRoomId = ref<string | undefined>(undefined);

// Loading state flags (transient UI state, not persisted to cache)
const isLoadingRooms = ref(false);
const isLoadingMessages = ref(false);
const messagesError = ref<string | null>(null);

// Search state for client-side chat search
const search = ref<{ query: string }>({ query: "" });
const isSearchActive = computed(() => {
    try {
        const q = (search.value.query || "").trim();
        return q.length > 0;
    } catch {
        return false;
    }
});
const searchTokens = computed(() =>
    (search.value.query || "")
        .split(/\s+/)
        .map(s => s.trim())
        .filter(Boolean),
);

// Room filter state for server-side multi-filtering. Legacy cached messageType/tags
// values are migrated by normalizeRoomFilter during cache restoration.
const roomFilter = ref<{
    messageTypes: string[];
    depth: number;
    tags: string[];
}>({
    messageTypes: [],
    depth: 5, // default depth
    tags: [],
});

// Timeline filter state for server-side multi-filtering of messages
// (distinct from roomFilter, which drives the room list).
const messageFilter = ref<{
    messageTypes: string[];
    tags: string[];
}>({
    messageTypes: [],
    tags: [],
});

const filterOptions = ref<FilterOptions>({
    messageTypes: [],
    tags: [],
});

    
    // Local settings object
    const localSettings = ref({
        notificationLevel: "ManagerCalls", // Default: only service_call notifications
        theme: "system" as "light" | "dark" | "system", // Theme preference
        botMessageOpacity: 100, // Bot message transparency (50-100%)
        fontSize: 16, // Global font size (14-24px)
    });
    
    // Unread messages tracking - roomKey is "botId_roomId"
    const unread = ref<Record<string, number>>({});

    // Botoraptor SDK instance + unsubscribe
    let chat: Botoraptor | null = null;
    let unsubscribe: (() => void) | null = null;
    let started = false;
    
    // Cache variables
    let saveTimeout: number | null = null;
    const CACHE_KEY = "uiStore_cache";
    
    // Debounce function to save state after 5 seconds
    function debounceSave() {
        if (saveTimeout) {
            clearTimeout(saveTimeout);
        }
        saveTimeout = setTimeout(() => {
            saveStateToCache();
        }, 5000) as unknown as number;
    }
    
    // Save state to localforage
    async function saveStateToCache() {
        try {
            const stateToSave = {
                bots: bots.value,
                rooms: rooms.value,
                messages: messages.value,
                selectedBotId: selectedBotId.value,
                selectedRoomId: selectedRoomId.value,
                localSettings: localSettings.value,
                unread: unread.value,
                search: search.value,
                roomFilter: roomFilter.value,
                messageFilter: messageFilter.value,
                filterOptions: filterOptions.value,
                timestamp: Date.now()
            };
            // Ensure we only persist plain JSON-serializable data to avoid IndexedDB DataCloneError
            // (Vue reactive proxies / non-cloneable values will be stripped by JSON serialization)
            const plain = JSON.parse(JSON.stringify(stateToSave));
            await localforage.setItem(CACHE_KEY, plain);
        } catch (err) {
            console.error("[uiStore] Failed to save state to cache", err);
        }
    }
    
    // Restore state from localforage
    async function restoreStateFromCache() {
        try {
            const cachedState = await localforage.getItem(CACHE_KEY);
            if (cachedState && typeof cachedState === 'object') {
                const state = cachedState as any;
                
                // Only restore if cache is less than 24 hours old
                const now = Date.now();
                const cacheAge = now - (state.timestamp || 0);
                const maxAge = 24 * 60 * 60 * 1000; // 24 hours in ms
                
                if (cacheAge < maxAge) {
                    if (state.bots) bots.value = state.bots;
                    if (state.rooms) rooms.value = state.rooms;
                    if (state.messages) messages.value = state.messages;
                    if (state.selectedBotId) selectedBotId.value = state.selectedBotId;
                    if (state.selectedRoomId) selectedRoomId.value = state.selectedRoomId;
                    if (state.localSettings) localSettings.value = state.localSettings;
                    if (state.unread) unread.value = state.unread;
                    if (state.search) search.value = state.search;
                    if (state.roomFilter) roomFilter.value = normalizeRoomFilter(state.roomFilter);
                    if (state.messageFilter) messageFilter.value = normalizeMessageFilter(state.messageFilter);
                    if (state.filterOptions) filterOptions.value = normalizeFilterOptions(state.filterOptions);
                    
                    return true;
                }
            }
        } catch (err) {
            console.error("[uiStore] Failed to restore state from cache", err);
        }
        return false;
    }

    function getApiKey(): string | null {
        try {
            return getStoredApiKey();
        } catch {
            return null;
        }
    }

    function ensureChat() {
        if (chat) return chat;
        const key = getApiKey();
        if (!key) throw new Error("API key missing");
        chat = new Botoraptor({ apiKey: key, listenerType: "ui" });
        return chat;
    }

    async function loadBots() {
        try {
            const cl = ensureChat();
            const b = await cl.getBots();
            bots.value = Array.isArray(b) ? b : [];
            // auto-select first bot if none selected
            if (!selectedBotId.value && bots.value.length > 0) {
                // choose first and load its rooms
                await selectBot(bots.value[0]);
            } else if (selectedBotId.value && bots.value.includes(selectedBotId.value)) {
                // Cache restore keeps the selected bot; refresh its complete option
                // lists before reloading rooms so stale selections can be pruned safely.
                await loadFilterOptions();
                await loadRooms(selectedBotId.value);
            }
        } catch (err) {
            console.error("uiStore: loadBots failed", err);
            bots.value = [];
        }
    }

    async function loadFilterOptions(): Promise<boolean> {
        try {
            const cl = ensureChat();
            const data = await cl.getFilterOptions();
            const next = normalizeFilterOptions(data);
            filterOptions.value = next;

            // Only prune after a successful, complete-database response. A failed
            // request must not silently discard cached selections.
            roomFilter.value.messageTypes = roomFilter.value.messageTypes.filter(type =>
                next.messageTypes.includes(type),
            );
            roomFilter.value.tags = roomFilter.value.tags.filter(tag => next.tags.includes(tag));
            return true;
        } catch (err) {
            console.error("uiStore: loadFilterOptions failed", err);
            return false;
        }
    }

    async function loadRooms(botId?: string) {
        if (!botId) {
            rooms.value = [];
            return;
        }
        isLoadingRooms.value = true;
        try {
            // Keep existing rooms visible while loading new ones —
            // the UI shows a spinner on top instead of flashing an empty list.
            const cl = ensureChat();
            const params: Parameters<typeof cl.getRooms>[0] = { botId };
            const hasMessageTypeFilter = roomFilter.value.messageTypes.length > 0;
            const hasTagFilter = roomFilter.value.tags.length > 0;
            if (hasMessageTypeFilter) params.messageTypes = [...roomFilter.value.messageTypes];
            if (hasTagFilter) params.tags = [...roomFilter.value.tags];
            if (hasMessageTypeFilter || hasTagFilter) {
                params.depth = roomFilter.value.depth;
            }
            const data = await cl.getRooms(params);
            rooms.value = Array.isArray(data.rooms) ? data.rooms : [];
        } catch (err) {
            console.error("uiStore: loadRooms failed", err);
            // Keep existing rooms on failure — don't wipe the list.
        } finally {
            isLoadingRooms.value = false;
        }
    }

     function normalizeMessages(arr: Message[] | undefined) {
         if (!arr) return [];
         return arr.map(m => {
            // copy first, then ensure defaults so we don't duplicate keys when spreading
            const base: any = { ...m };
            base.id = base.id || `${base.botId}-${base.roomId || "default"}-${base.createdAt || Date.now()}`;
            base.botId = base.botId;
            base.roomId = base.roomId || "default";
            base.userId = base.userId || base.username || "user";
             base.text = base.text || "";
             base.messageType = base.messageType || "text";
             base.tags = getEntityTags(base);
             base.createdAt = base.createdAt || new Date().toISOString();
            return base as Message;
        });
    }

    async function loadMessages(roomId?: string, opts?: { reset?: boolean }) {
        if (!selectedBotId.value) {
            messages.value = [];
            return;
        }
        if (!roomId) {
            messages.value = [];
            return;
        }
        if (opts?.reset) {
            // Fresh load: clear the timeline before fetching so the UI re-renders
            // from scratch (used after filter changes).
            messages.value = [];
        }
        isLoadingMessages.value = true;
        messagesError.value = null;
        try {
            const cl = ensureChat();
            const params: { botId: string; roomId: string; limit: number; types?: string; tags?: string[] | string } = {
                botId: selectedBotId.value,
                roomId,
                limit: 20,
            };
            if (messageFilter.value.messageTypes.length > 0) {
                params.types = messageFilter.value.messageTypes.join(",");
            }
            if (messageFilter.value.tags.length > 0) {
                params.tags = messageFilter.value.tags.join(",");
            }
            const data = await cl.getMessages(params);
            messages.value = Array.isArray(data) ? normalizeMessages(data) : [];
        } catch (err) {
            console.error("uiStore: loadMessages failed", err);
            // Keep existing messages visible on error — don't clear them
            messagesError.value = err instanceof Error ? err.message : "Failed to load messages";
        } finally {
            isLoadingMessages.value = false;
        }
    }

    // Pagination: load older messages before the given cursorId and merge into store
    async function loadOlderMessages(roomId: string, cursorId?: number | string, types?: string[]) {
        if (!selectedBotId.value) return;
        if (!roomId) return;
        try {
            const cl = ensureChat();
            const params: any = { botId: selectedBotId.value, roomId, limit: 20 };
            if (cursorId !== undefined && cursorId !== null) params.cursorId = cursorId;
            // The store's messageFilter is the single source for timeline filters;
            // the legacy `types` parameter is honored only when the store has no
            // message type selections.
            const typeFilters =
                messageFilter.value.messageTypes.length > 0 ? messageFilter.value.messageTypes : (types ?? []);
            if (typeFilters.length > 0) params.types = typeFilters.join(",");
            if (messageFilter.value.tags.length > 0) params.tags = messageFilter.value.tags.join(",");

            const data = await cl.getMessages(params);
            const newRows = Array.isArray(data) ? normalizeMessages(data) : [];
            if (!newRows.length) return;

            // Merge older messages with existing; dedupe by id
            const map = new Map<string | number, any>();
            for (const m of [...newRows, ...messages.value]) {
                const id = (m as any).id ?? `${(m as any).botId}-${(m as any).roomId}-${(m as any).createdAt}`;
                map.set(id as any, m);
            }
            messages.value = Array.from(map.values());
        } catch (err) {
            console.error("uiStore: loadOlderMessages failed", err);
        }
    }

    async function selectBot(botId: string) {
        selectedBotId.value = botId;
        // reset selected room when switching bot
        selectedRoomId.value = undefined;
        // clear messages when switching bot
        messages.value = [];
        await loadFilterOptions();
        await loadRooms(botId);
        // don't auto-select a room here; wait for user click
    }

    async function selectRoom(roomId: string) {
        selectedRoomId.value = roomId;
        // Clear unread count for this room when selected
        if (selectedBotId.value) {
            const roomKey = `${selectedBotId.value}_${roomId}`;
            unread.value[roomKey] = 0;
        }
        await loadMessages(roomId);
    }

    async function refresh() {
        if (selectedRoomId.value) {
            await loadMessages(selectedRoomId.value);
        } else if (selectedBotId.value) {
            await loadRooms(selectedBotId.value);
        } else {
            await loadBots();
        }
    }

    // Event reaction logic for incoming messages (from Botoraptor longpoll)
    async function onIncomingMessage(m: Message) {
        try {
            // Handle notifications based on notification level setting
            handleNotification(m);
            
            // Track unread messages - only if room is not currently selected
            if (m.botId && m.roomId &&
                !(selectedBotId.value === m.botId && selectedRoomId.value === m.roomId)) {
                const roomKey = `${m.botId}_${m.roomId}`;
                if (!unread.value[roomKey]) {
                    unread.value[roomKey] = 0;
                }
                unread.value[roomKey]++;
            }
            
            // If the message belongs to the currently selected bot -> refresh rooms
            if (m.botId && selectedBotId.value && m.botId === selectedBotId.value) {
                await loadRooms(selectedBotId.value);
            }
            // If the message belongs to the currently selected room -> refresh messages
            if (m.roomId && selectedRoomId.value && m.roomId === selectedRoomId.value) {
                await loadMessages(selectedRoomId.value);
            }
        } catch (err) {
            console.error("uiStore: onIncomingMessage handler error", err);
        }
    }

    // Handle notifications based on notification level setting
    function handleNotification(m: Message) {
        try {
            const notificationLevel = localSettings.value.notificationLevel;
    
            // Skip notifications if level is None
            if (notificationLevel === "None") {
                return;
            }
    
            // Only react to specific message types
            const messageType = String(m.messageType || "text");
            let shouldNotify = false;
            if (notificationLevel === "All") {
                // Only user_message and service_call in All mode
                shouldNotify = messageType === "user_message" || messageType === "service_call";
            } else if (notificationLevel === "ManagerCalls") {
                // Only service_call in ManagerCalls mode
                shouldNotify = messageType === "service_call";
            }
    
            if (!shouldNotify) return;
    
            const title = messageType === "service_call"
                ? t("toast.service_call")
                : t("chat.type.user_message");
    
            const body = m.text || "";
    
            // Show notification with debouncing (notificationManager will suppress when window focused)
            notificationManager.showNotification({
                title,
                body,
                tag: `botoraptor-${m.botId}-${m.roomId}`
            });
        } catch (err) {
            console.error("uiStore: handleNotification error", err);
        }
    }

    // Present an Ionic toast (used when page is visible)
    const presentToast = async (position: "top" | "middle" | "bottom", message = t("toast.service_call")) => {
        try {
            const toast = await toastController.create({
                message,
                duration: 1500,
                position,
            });
            await toast.present();
        } catch (err) {
            console.error("uiStore: presentToast failed", err);
        }
    };

    function startListener() {
        if (started) return;
        try {
            const cl = ensureChat();
            // register onMessage callback
            unsubscribe = cl.onMessage(async (m: Message) => {
                try {
                    // Special handling for service_call messages:
                    // - if page is not visible -> use standard browser alert
                    // - if visible -> present an Ionic toast directly
                    try {
                        const mt = (m && (m.messageType || "text")) as string;
                        if (mt === "service_call") {
                            const text = m.text || t("toast.service_call");
                            if (typeof document !== "undefined" && document.hidden) {
                                try {
                                    // use standard browser alert when page isn't visible
                                    // keep it simple and synchronous
                                    window.alert(text);
                                } catch {}
                            } else {
                                // page visible -> use Ionic toast
                                await presentToast("top", text);
                            }
                        }
                    } catch (innerErr) {
                        console.error("uiStore: service_call notification failed", innerErr);
                    }

                    // still run normal incoming-message handling
                    await onIncomingMessage(m);
                } catch (e) {
                    console.error("uiStore: listener error", e);
                }
            });
            // start longpolling as UI listener (listen to all bots)
            try {
                cl.start({ botIds: null, listenerType: "ui" });
            } catch (e) {
                // Botoraptor.start may throw if misconfigured; still keep onMessage subscription in place
                console.error("uiStore: chat.start threw", e);
            }
            started = true;
        } catch (err) {
            console.error("uiStore: startListener failed", err);
        }
    }

    function stopListener() {
        try {
            if (chat) {
                try {
                    chat.stop();
                } catch {}
            }
            if (unsubscribe) {
                try {
                    unsubscribe();
                } catch {}
                unsubscribe = null;
            }
        } finally {
            started = false;
        }
    }

    // Public init: start listener and load initial bots -> which will auto-select first bot
    async function init() {
        try {
            // Initialize notification manager and request permission
            await notificationManager.requestPermission();
            
            // Try to restore state from cache first
            const restored = await restoreStateFromCache();
            
            // Apply theme settings after restoring from cache
            applyThemeSettings();
            
            // Start listener
            startListener();
            
            // Load bots if not restored from cache or if we need fresh data
            if (!restored) {
                await loadBots();
            } else {
                // Even if restored, we might want to refresh bots to get latest data
                // but keep the selected bot if it exists
                const currentBotId = selectedBotId.value;
                await loadBots();
                // Restore selection if it was lost during refresh
                if (currentBotId && !selectedBotId.value && bots.value.includes(currentBotId)) {
                    await selectBot(currentBotId);
                }
            }
            
            // Load client config for quick answers
            await loadClientConfig();
        } catch (err) {
            console.error("uiStore: init failed", err);
        }
    }
    
    // Add quickAnswers to store state
    const quickAnswers = ref<string[]>([]);
    
    // Load client configuration including quick answers
    async function loadClientConfig() {
        try {
            const cl = ensureChat();
            const config = await cl.getClientConfig();
            if (config.quickAnswersPreset && Array.isArray(config.quickAnswersPreset)) {
                quickAnswers.value = config.quickAnswersPreset;
            }
        } catch (err) {
            console.error("Failed to load client config", err);
        }
    }

    // Set up watchers to trigger cache save on state changes
    watch([bots, rooms, messages, selectedBotId, selectedRoomId, localSettings, unread, search, roomFilter, messageFilter, filterOptions], () => {
        debounceSave();
    }, { deep: true });
    
    // computed getters for convenience
    const filteredMessages = computed(() => {
        if (!selectedBotId.value) return messages.value;
        return messages.value.filter(m => m.botId === selectedBotId.value);
    });

    // Computed effective theme (resolves "system" to actual light/dark)
    const effectiveTheme = computed(() => {
        const theme = localSettings.value.theme;
        if (theme === "system") {
            // Check system preference
            if (typeof window !== "undefined" && window.matchMedia) {
                return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
            }
            return "light";
        }
        return theme;
    });

    // Apply theme and font settings to document
    function applyThemeSettings() {
        if (typeof document === "undefined") return;
        
        const root = document.documentElement;
        const theme = effectiveTheme.value;
        
        // Apply Ionic dark palette class
        // The .ion-palette-dark class must be on the html element
        if (theme === "dark") {
            root.classList.add("ion-palette-dark");
        } else {
            root.classList.remove("ion-palette-dark");
        }
        
        // Set Ionic color scheme
        root.style.setProperty("--ion-color-scheme", theme);
        
        // Apply font size
        const fontSize = localSettings.value.fontSize;
        root.style.setProperty("--app-font-size", `${fontSize}px`);
        root.style.fontSize = `${fontSize}px`;
        
        // Apply bot message opacity (convert percentage to decimal)
        const opacity = localSettings.value.botMessageOpacity / 100;
        root.style.setProperty("--bot-message-opacity", String(opacity));
    }

    // Watch for theme changes and apply them
    watch(() => localSettings.value.theme, applyThemeSettings, { immediate: false });
    watch(() => localSettings.value.fontSize, applyThemeSettings, { immediate: false });
    watch(() => localSettings.value.botMessageOpacity, applyThemeSettings, { immediate: false });

    // Listen for system theme changes when in "system" mode
    if (typeof window !== "undefined" && window.matchMedia) {
        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        mediaQuery.addEventListener("change", () => {
            if (localSettings.value.theme === "system") {
                applyThemeSettings();
            }
        });
    }

    // Expose quickAnswers getter
    const getQuickAnswers = computed(() => quickAnswers.value);

    return {
        // state
        bots,
        rooms,
        messages,
        selectedBotId,
        selectedRoomId,
        localSettings,
        unread,
        search,
        quickAnswers,
        roomFilter,
        messageFilter,
        filterOptions,
        isLoadingRooms,
        isLoadingMessages,
        messagesError,

        // getters
        filteredMessages,
        isSearchActive,
        searchTokens,
        getQuickAnswers,
        effectiveTheme,

        // actions
        init,
        loadBots,
        loadFilterOptions,
        loadRooms,
        loadMessages,
        loadOlderMessages,
        selectBot,
        selectRoom,
        refresh,
        startListener,
        stopListener,
        loadClientConfig,
        applyThemeSettings,
        
        // cache functions (exposed for manual control if needed)
        saveStateToCache,
        restoreStateFromCache,
    };
});
