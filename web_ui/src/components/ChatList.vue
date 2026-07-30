<template>
    <div class="search-bar">
        <ion-item lines="full" class="search-item">
            <ion-icon :icon="searchOutline" slot="start" aria-hidden="true" />
            <ion-input
                v-model="searchLocal"
                :placeholder="$t('search.placeholder')"
                @keydown="onSearchKeydown"
            />
            <div
                v-if="isSearching"
                slot="end"
                class="search-spinner"
            >
                <ion-spinner name="dots" />
            </div>
            <ion-button
                slot="end"
                fill="clear"
                size="small"
                :disabled="!searchLocal"
                @click="clearSearch"
                :aria-label="$t('search.clear')"
                class="clear-btn"
            >
                <ion-icon :icon="closeCircleOutline" />
            </ion-button>
        </ion-item>
    </div>
    <div class="filter-bar">
        <ion-item lines="none" class="filter-item">
            <ion-select
                v-model="filterState.messageType"
                interface="popover"
                :placeholder="$t('filter.messageType')"
                @ionChange="onFilterChange"
                class="filter-select-compact"
            >
                <ion-select-option value="">{{ $t('filter.none') }}</ion-select-option>
                <ion-select-option value="user_message">{{ $t('filter.user_message') }}</ion-select-option>
                <ion-select-option value="user_message_service">{{ $t('filter.user_message_service') }}</ion-select-option>
                <ion-select-option value="bot_message_service">{{ $t('filter.bot_message_service') }}</ion-select-option>
                <ion-select-option value="manager_message">{{ $t('filter.manager_message') }}</ion-select-option>
                <ion-select-option value="service_call">{{ $t('filter.service_call') }}</ion-select-option>
                <ion-select-option value="error_message">{{ $t('filter.error_message') }}</ion-select-option>
                <ion-select-option value="event">{{ $t('filter.event') }}</ion-select-option>
            </ion-select>
            <ion-input
                v-model.number="filterState.depth"
                type="number"
                :min="1"
                :max="10"
                :placeholder="$t('filter.depth')"
                @ionChange="onFilterChange"
                class="filter-depth-compact"
            />
            <ion-input
                v-model="filterState.tags"
                :placeholder="$t('filter.tags')"
                @ionChange="onFilterChange"
                class="filter-tags"
            />
        </ion-item>
    </div>
    <ion-list>
        <!-- Loading skeleton when rooms are loading for the first time (no existing rooms) -->
        <div
            v-if="isLoadingRooms && chats.length === 0"
            class="loading-skeleton"
        >
            <div
                v-for="n in 6"
                :key="'skel-' + n"
                class="skeleton-item"
            >
                <div class="skeleton-avatar" />
                <div class="skeleton-lines">
                    <div class="skeleton-line skeleton-line-name" />
                    <div class="skeleton-line skeleton-line-preview" />
                </div>
            </div>
        </div>

        <!-- Subtle spinner when rooms are loading but existing rooms are visible (bot switch / filter) -->
        <div
            v-else-if="isLoadingRooms && chats.length > 0"
            class="loading-indicator"
        >
            <ion-spinner name="dots" />
        </div>

        <!-- Empty state -->
        <div
            v-else-if="filteredChats.length === 0 && !isLoadingRooms"
            class="empty-list"
        >
            <template v-if="isSearchActive">
                <div class="empty-list-icon">🔍</div>
                <div class="empty-list-msg">{{ $t("list.empty") }}</div>
                <div class="empty-list-sub">No matching chats found</div>
            </template>
            <template v-else>
                <div class="empty-list-icon">💬</div>
                <div class="empty-list-msg">{{ $t("list.empty") }}</div>
            </template>
        </div>

        <!-- Chat list items -->
        <ion-item
            v-else
            v-for="chat in filteredChats"
            :key="chat.roomId"
            :class="{ active: chat.roomId === selectedRoomId }"
            button
            @click="selectChat(chat.roomId)"
        >
            <div
                class="avatar"
                slot="start"
                :style="avatarStyle(chat.displayName)"
            >
                {{ getInitial(chat.displayName) }}
            </div>
            <ion-label>
                <h3>
                    <span v-if="chat.name" class="name">
                        <Highlighter
                            v-if="isSearchActive && searchTokens.length"
                            :searchWords="searchTokens"
                            :autoEscape="true"
                            :textToHighlight="chat.name"
                            highlightClassName="search-hl"
                        />
                        <template v-else>{{ chat.name }}</template>
                    </span>
                    <span v-if="chat.name && chat.username" class="separator"><br></br></span>
                    <span v-if="chat.username" class="username">
                        <Highlighter
                            v-if="isSearchActive && searchTokens.length"
                            :searchWords="searchTokens"
                            :autoEscape="true"
                            :textToHighlight="'@' + chat.username"
                            highlightClassName="search-hl"
                        />
                        <template v-else>@{{ chat.username }}</template>
                    </span>
                </h3>
                <p class="preview">
                    <Highlighter
                        v-if="isSearchActive && searchTokens.length"
                        :searchWords="searchTokens"
                        :autoEscape="true"
                        :textToHighlight="chat.preview"
                        highlightClassName="search-hl"
                    />
                    <template v-else>{{ chat.preview }}</template>
                </p>
            </ion-label>
            <div slot="end" class="end-content">
                <ion-note>{{ chat.timeAgo }}</ion-note>
                <div
                    v-if="chat.unreadCount > 0"
                    class="unread-dot"
                    :class="{ 'service-call': chat.isServiceCall }"
                ></div>
            </div>
        </ion-item>
    </ion-list>
</template>

<script setup lang="ts">
import { computed, defineProps, defineEmits, watch, onMounted, ref } from "vue";
import { IonList, IonLabel, IonItem, IonNote, IonInput, IonIcon, IonButton, IonSelect, IonSelectOption, IonSpinner } from "@ionic/vue";
import { format } from "timeago.js";
import { useI18n } from "vue-i18n";
import Highlighter from "vue-highlight-words";
import { useUiStore } from "../stores/uiStore";
import { storeToRefs } from "pinia";
import { searchOutline, closeCircleOutline } from "ionicons/icons";
const { t } = useI18n();
const uiStore = useUiStore();
const { isLoadingRooms, isSearchActive, searchTokens } = storeToRefs(uiStore);

// Filter state - synced with uiStore
const filterState = ref({
    messageType: uiStore.roomFilter.messageType || "",
    depth: uiStore.roomFilter.depth,
    tags: uiStore.roomFilter.tags || "",
});

// Watch for external changes to roomFilter (e.g., from cache restore)
watch(
    () => uiStore.roomFilter,
    (newFilter) => {
        filterState.value.messageType = newFilter.messageType || "";
        filterState.value.depth = newFilter.depth;
        filterState.value.tags = newFilter.tags || "";
    },
    { deep: true }
);

// Handle filter changes - update store and refresh rooms
function onFilterChange() {
    // Convert empty string to null for the store
    uiStore.roomFilter.messageType = filterState.value.messageType || null;
    // Ensure depth is within bounds
    let depth = filterState.value.depth;
    if (depth < 1) depth = 1;
    if (depth > 10) depth = 10;
    filterState.value.depth = depth;
    uiStore.roomFilter.depth = depth;
    uiStore.roomFilter.tags = filterState.value.tags || null;
    
    // Refresh rooms with new filter
    if (uiStore.selectedBotId) {
        uiStore.loadRooms(uiStore.selectedBotId);
    }
}

const searchLocal = ref(uiStore.search.query);
let searchDebounce: any = null;
const isSearching = ref(false);

watch(
    () => searchLocal.value,
    val => {
        isSearching.value = true;
        if (searchDebounce) clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => {
            uiStore.search.query = String(val || "");
            isSearching.value = false;
        }, 150);
    },
);

watch(
    () => uiStore.search.query,
    q => {
        if (q !== searchLocal.value) searchLocal.value = q;
    },
);

function onSearchKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
        clearSearch();
        e.preventDefault();
    }
}

function clearSearch() {
    searchLocal.value = "";
    uiStore.search.query = "";
    isSearching.value = false;
}

/**
 * ChatList now accepts either:
 *  - messages: Array<any> (legacy) OR
 *  - rooms: Array<{ roomId, users, lastMessage }>
 *
 * If rooms is provided it will be used (preferred) so the list shows recent rooms
 * returned by the server (with users and lastMessage).
 */
const props = defineProps<{
    messages?: Array<any>;
    rooms?: Array<any>;
    selectedRoomId?: string;
    selectedBotId?: string;
}>();

onMounted(() => {
    try {
        // eslint-disable-next-line no-console
        console.debug("[ChatList] mounted props.rooms:", props.rooms);
    } catch {}
});

watch(
    () => props.rooms,
    n => {
        try {
            // eslint-disable-next-line no-console
            console.debug("[ChatList] props.rooms changed:", n && n.length ? `${n.length} rooms` : n);
        } catch {}
    },
    { immediate: true },
);

const emit = defineEmits(["select-room"]);

function selectChat(roomId: string) {
    emit("select-room", roomId);
}

// Helpers for avatar and truncation
function getInitial(name?: string) {
    const n = (name || "").trim();
    return n.length ? n[0].toUpperCase() : "?";
}

function colorFromName(name?: string) {
    const n = (name || "user").toString();
    let hash = 0;
    for (let i = 0; i < n.length; i++) hash = (hash * 31 + n.charCodeAt(i)) | 0;
    const hue = Math.abs(hash) % 360;
    const sat = 65; // %
    const light = 45; // %
    return `hsl(${hue}deg ${sat}% ${light}%)`;
}

function avatarStyle(name?: string) {
    const bg = colorFromName(name);
    return {
        background: bg,
        color: "#fff",
    } as Record<string, string>;
}

function truncate(str: string, max = 32) {
    const s = (str || "").toString();
    if (s.length <= max) return s;
    if (max <= 3) return s.slice(0, max);
    return s.slice(0, max - 3) + "...";
}

// Get unread count for a room
function getUnreadCount(roomId: string): number {
    if (!props.selectedBotId) return 0;
    const roomKey = `${props.selectedBotId}_${roomId}`;
    return uiStore.unread[roomKey] || 0;
}

// Check if last message is a service_call
function isLastMessageServiceCall(room: any): boolean {
    return room.lastMessage?.messageType === "service_call";
}

const chats = computed(() => {
    // If rooms provided, map rooms -> chat preview items
    if (props.rooms && Array.isArray(props.rooms) && props.rooms.length > 0) {
        // Sort rooms by lastMessage.createdAt first (newest first)
        const sortedRooms = [...props.rooms].sort((a, b) => {
            const aTime = a.lastMessage?.createdAt ? new Date(a.lastMessage.createdAt).getTime() : 0;
            const bTime = b.lastMessage?.createdAt ? new Date(b.lastMessage.createdAt).getTime() : 0;
            return bTime - aTime; // descending (newest first)
        });

        const arr = sortedRooms.map(r => {
            const lm = r.lastMessage || {};
            // Extract name and username from users array
            const user = r.users && r.users[0];
            const name = user?.name;
            const username = user?.username || user?.userId || lm.userId || r.roomId;
            // Use name as primary display, fallback to username
            const displayName = name || username;

            const preview = truncate(lm.text || "", 32);
            const timeAgo = lm.createdAt ? format(new Date(lm.createdAt)) : "";
            const unreadCount = getUnreadCount(r.roomId);
            const isServiceCall = isLastMessageServiceCall(r);
            return {
                roomId: r.roomId,
                username, // Keep for backward compatibility and search
                name, // Store name separately
                displayName, // Use this for display
                preview,
                lastText: lm.text || "",
                timeAgo,
                unreadCount,
                isServiceCall,
                // Keep timestamp for potential future use
                timestamp: lm.createdAt ? new Date(lm.createdAt).getTime() : 0,
            };
        });
        return arr;
    }

    // Fallback: derive from messages (legacy behavior)
    const map = new Map<string, any>();
    for (const m of props.messages || []) {
        const rid = m.roomId || "default";
        if (!map.has(rid)) {
            map.set(rid, m);
        } else {
            const curr = map.get(rid);
            if (new Date(m.createdAt) > new Date(curr.createdAt)) {
                map.set(rid, m);
            }
        }
    }
    const arr: any[] = [];
    for (const [roomId, m] of map.entries()) {
        const username = m.userId || m.username || roomId;
        const name = m.name; // Extract name from message if available
        const displayName = name || username; // Use name as primary, fallback to username
        arr.push({
            roomId,
            username, // Keep for backward compatibility and search
            name, // Store name separately
            displayName, // Use this for display
            preview: truncate(m.text || "", 32),
            lastText: m.text || "",
            timeAgo: m.createdAt ? format(new Date(m.createdAt)) : "",
            unreadCount: getUnreadCount(roomId),
            isServiceCall: m.messageType === "service_call",
            // Keep timestamp for potential future use
            timestamp: m.createdAt ? new Date(m.createdAt).getTime() : 0,
        });
    }
    // sort by actual timestamp desc, not formatted timeago string
    arr.sort((a, b) => b.timestamp - a.timestamp);
    return arr;
});

const filteredChats = computed(() => {
    const list = chats.value || [];
    const active = isSearchActive.value;
    if (!active) return list;
    const tokens = (searchTokens.value || []) as string[];
    if (!tokens || tokens.length === 0) return list;
    const lowerTokens = tokens.map(s => s.toLowerCase());
    function matches(chat: any) {
        const username = (chat.username || "").toString().toLowerCase();
        const name = (chat.name || "").toString().toLowerCase();
        const displayName = (chat.displayName || "").toString().toLowerCase();
        const lastText = (chat.lastText || chat.preview || "").toString().toLowerCase();
        const roomId = (chat.roomId || "").toString().toLowerCase();
        const hasUsername = !!chat.username;
        for (const tok of lowerTokens) {
            if (!tok) continue;
            // Search in name field (primary)
            if (name.includes(tok)) return true;
            // Search in username field (fallback)
            if (username.includes(tok)) return true;
            // Search in display name (combined)
            if (displayName.includes(tok)) return true;
            // Search in message text
            if (lastText.includes(tok)) return true;
            // Search in roomId only if no username/name available
            if (!hasUsername && roomId.includes(tok)) return true;
        }
        return false;
    }
    return list.filter(matches);
});
</script>

<style scoped>
/* Base item transitions */
ion-item {
    transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
}

/* Hover state for non-active items */
ion-item:not(.active):hover {
    --background: var(--ion-color-light);
}

.ion-palette-dark ion-item:not(.active):hover {
    --background: rgba(255, 255, 255, 0.05);
}

/* Press-down feedback */
ion-item:active {
    transform: scale(0.985);
}

/* Active chat: left accent bar + slight shadow */
ion-item.active {
    --background: var(--ion-color-primary-tint);
    --color: var(--ion-color-primary-contrast);
    border-left: 3px solid var(--ion-color-primary);
    padding-left: 5px !important;
    box-sizing: border-box;
    border-radius: 8px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}
ion-item.active ion-label h3 {
    font-weight: 600;
}
ion-item.active ion-label .preview {
    color: var(--ion-color-primary-contrast);
    opacity: 0.8;
}

/* Avatar circle with first letter */
.avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: 14px;
    color: #fff;
    user-select: none;
}

/* Preview text styling and ensure single-line clamp in addition to hard truncation */
ion-label .preview {
    margin: 2px 0 0;
    color: var(--ion-color-medium);
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.empty-list {
    padding: 12px;
    color: var(--ion-color-medium);
    text-align: center;
}

.empty-list-icon {
    font-size: 32px;
    margin-bottom: 8px;
}

.empty-list-msg {
    font-size: 15px;
    font-weight: 600;
    color: var(--ion-text-color);
    margin-bottom: 4px;
}

.empty-list-sub {
    font-size: 13px;
    color: var(--ion-color-medium);
}

/* Search spinner */
.search-spinner {
    display: flex;
    align-items: center;
    padding: 0 4px;
    --color: var(--ion-color-medium);
}

/* Search highlight */
:deep(.search-hl) {
    background: var(--ion-color-warning-tint);
    color: var(--ion-color-warning-contrast);
    border-radius: 3px;
    padding: 0 2px;
}

/* End content container for time and unread indicator */
.end-content {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
}

/* Unread indicator dot */
.unread-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: var(--ion-color-primary);
}

/* Red dot for service calls */
.unread-dot.service-call {
    background-color: var(--ion-color-danger);
}

/* Search bar styling */
.search-bar {
    padding: 8px 8px 4px 8px;
}
.search-item ::v-deep ion-input {
    --padding-start: 0;
}
.clear-btn {
    margin-left: 4px;
}

/* Filter bar styling - compact */
.filter-bar {
    padding: 4px 4px 6px 4px;
    border-bottom: 1px solid var(--ion-color-light-shade);
    background: rgba(0, 0, 0, 0.015);
}

.ion-palette-dark .filter-bar {
    border-bottom-color: rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.02);
}
.filter-item {
    --padding-start: 0;
    --padding-end: 0;
    --inner-padding-end: 0;
    --min-height: 32px;
    display: flex;
    align-items: center;
    gap: 4px;
}
.filter-select-compact {
    flex: 1;
    min-width: 0;
    font-size: 13px;
}
.filter-depth-compact {
    width: 48px;
    flex-shrink: 0;
    font-size: 13px;
}
.filter-tags {
    flex: 1;
    min-width: 0;
    font-size: 13px;
}

/* Name and username styling */
.name {
    font-weight: 700;
    color: #111827;
}

.ion-palette-dark .name {
    color: #f9fafb;
}

.username {
    font-weight: 700;
    color: #374151;
    font-size: 0.9em;
}

.ion-palette-dark .username {
    color: #d1d5db;
}

/* Time styling in chat list */
ion-note {
    color: #374151;
    font-weight: 700;
}

.ion-palette-dark ion-note {
    color: #d1d5db;
}

.separator {
    margin: 0 2px;
}

/* Loading skeleton */
.loading-skeleton {
    padding: 4px 0;
}

.skeleton-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
}

.skeleton-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--ion-color-light-shade);
    animation: skelPulse 1.5s ease-in-out infinite;
    flex-shrink: 0;
}

.skeleton-lines {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.skeleton-line {
    height: 12px;
    border-radius: 6px;
    background: var(--ion-color-light-shade);
    animation: skelPulse 1.5s ease-in-out infinite;
}

.skeleton-line-name {
    width: 60%;
}

.skeleton-line-preview {
    width: 85%;
}

@keyframes skelPulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
}

/* Dark mode skeleton */
.ion-palette-dark .skeleton-avatar,
.ion-palette-dark .skeleton-line {
    background: rgba(255, 255, 255, 0.1);
}

/* Loading indicator at top of list */
.loading-indicator {
    display: flex;
    justify-content: center;
    padding: 8px 0;
}
</style>
