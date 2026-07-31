<!--
FILE: apps/web/src/components/ChatList.vue
PURPOSE: Present searchable bot conversations and compact database-backed multi-filters.
OWNS: Inbox search/filter controls, room preview mapping, selection, and list states.
EXPORTS: ChatList — selectable conversation inbox surface.
DOCS: .agents/reports/plan_multi-filter_2026-07-31.md, docs/core/web-ui.md
-->
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
    <div class="filter-bar" aria-label="Conversation filters">
        <div class="filter-grid">
            <div class="filter-field filter-field-type">
                <span class="filter-label">{{ $t('filter.messageTypes') }}</span>
                <button
                    id="message-type-filter-trigger"
                    type="button"
                    class="filter-trigger"
                    :aria-label="$t('filter.messageTypes')"
                    aria-haspopup="dialog"
                    @click="toggleFilterMenu('messageTypes', $event)"
                >
                    <span class="filter-trigger-summary">{{ messageTypeSummary }}</span>
                    <ion-icon :icon="chevronDownOutline" aria-hidden="true" />
                </button>
                <ion-popover
                    :is-open="openFilterMenu === 'messageTypes'"
                    :event="filterMenuEvent"
                    @didDismiss="closeFilterMenu"
                >
                    <ion-list class="filter-options-list">
                        <ion-item v-for="type in filterOptions.messageTypes" :key="type" lines="none">
                            <ion-checkbox
                                slot="start"
                                :checked="filterState.messageTypes.includes(type)"
                                @ionChange="toggleMessageType(type, $event)"
                            />
                            <ion-label>{{ messageTypeLabel(type) }}</ion-label>
                        </ion-item>
                        <ion-item v-if="filterOptions.messageTypes.length === 0" lines="none">
                            <ion-label class="filter-empty-options">{{ $t('filter.none') }}</ion-label>
                        </ion-item>
                    </ion-list>
                </ion-popover>
            </div>

            <div class="filter-field filter-field-tags">
                <span class="filter-label">{{ $t('filter.tags') }}</span>
                <button
                    id="tag-filter-trigger"
                    type="button"
                    class="filter-trigger"
                    :aria-label="$t('filter.tags')"
                    aria-haspopup="dialog"
                    @click="toggleFilterMenu('tags', $event)"
                >
                    <span class="filter-trigger-summary">{{ tagSummary }}</span>
                    <ion-icon :icon="chevronDownOutline" aria-hidden="true" />
                </button>
                <ion-popover
                    :is-open="openFilterMenu === 'tags'"
                    :event="filterMenuEvent"
                    @didDismiss="closeFilterMenu"
                >
                    <ion-list class="filter-options-list">
                        <ion-item v-for="tag in filterOptions.tags" :key="tag" lines="none">
                            <ion-checkbox
                                slot="start"
                                :checked="filterState.tags.includes(tag)"
                                @ionChange="toggleTag(tag, $event)"
                            />
                            <ion-label>{{ tag }}</ion-label>
                        </ion-item>
                        <ion-item v-if="filterOptions.tags.length === 0" lines="none">
                            <ion-label class="filter-empty-options">{{ $t('filter.none') }}</ion-label>
                        </ion-item>
                    </ion-list>
                </ion-popover>
            </div>

            <label class="filter-field filter-field-depth">
                <span class="filter-label">{{ $t('filter.depth') }}</span>
                <ion-input
                    v-model.number="filterState.depth"
                    type="number"
                    :min="1"
                    :max="10"
                    @ionChange="onFilterChange"
                    class="filter-depth-compact"
                />
            </label>

            <button
                v-if="hasActiveFilters"
                type="button"
                class="filter-clear"
                @click="clearFilters"
            >
                {{ $t('filter.clear') }}
            </button>
        </div>
    </div>
    <ion-list class="chat-list">
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
import { computed, watch, ref } from "vue";
import { IonList, IonLabel, IonItem, IonNote, IonInput, IonIcon, IonButton, IonCheckbox, IonPopover, IonSpinner } from "@ionic/vue";
import { format } from "timeago.js";
import { useI18n } from "vue-i18n";
import Highlighter from "vue-highlight-words";
import { useUiStore } from "../stores/uiStore";
import { storeToRefs } from "pinia";
import { searchOutline, closeCircleOutline, chevronDownOutline } from "ionicons/icons";
const { t } = useI18n();
const uiStore = useUiStore();
const { isLoadingRooms, isSearchActive, searchTokens } = storeToRefs(uiStore);

// Filter state - synced with uiStore
const filterState = ref({
    messageTypes: [...(uiStore.roomFilter.messageTypes || [])],
    depth: uiStore.roomFilter.depth,
    tags: [...(uiStore.roomFilter.tags || [])],
});

const filterOptions = computed(() => uiStore.filterOptions);
const openFilterMenu = ref<"messageTypes" | "tags" | null>(null);
const filterMenuEvent = ref<Event | undefined>(undefined);

// Watch for external changes to roomFilter (e.g., from cache restore)
watch(
    () => uiStore.roomFilter,
    (newFilter) => {
        filterState.value.messageTypes = [...(newFilter.messageTypes || [])];
        filterState.value.depth = newFilter.depth;
        filterState.value.tags = [...(newFilter.tags || [])];
    },
    { deep: true }
);

// Handle filter changes - update store and refresh rooms
function onFilterChange() {
    filterState.value.messageTypes = Array.from(new Set(
        filterState.value.messageTypes.map(value => String(value).trim()).filter(Boolean),
    ));
    filterState.value.tags = Array.from(new Set(
        filterState.value.tags.map(value => String(value).trim()).filter(Boolean),
    ));
    uiStore.roomFilter.messageTypes = [...filterState.value.messageTypes];
    // Ensure depth is within bounds
    let depth = Number(filterState.value.depth);
    if (!Number.isFinite(depth)) depth = 5;
    if (depth < 1) depth = 1;
    if (depth > 10) depth = 10;
    depth = Math.floor(depth);
    filterState.value.depth = depth;
    uiStore.roomFilter.depth = depth;
    uiStore.roomFilter.tags = [...filterState.value.tags];
    
    // Refresh rooms with new filter
    if (uiStore.selectedBotId) {
        uiStore.loadRooms(uiStore.selectedBotId);
    }
}

const hasActiveFilters = computed(() => Boolean(
    filterState.value.messageTypes.length ||
    filterState.value.tags.length ||
    filterState.value.depth !== 5,
));

function clearFilters() {
    filterState.value.messageTypes = [];
    filterState.value.depth = 5;
    filterState.value.tags = [];
    onFilterChange();
}

function toggleFilterMenu(menu: "messageTypes" | "tags", event: Event) {
    if (openFilterMenu.value === menu) {
        openFilterMenu.value = null;
        return;
    }
    filterMenuEvent.value = event;
    openFilterMenu.value = menu;
}

function closeFilterMenu() {
    openFilterMenu.value = null;
    filterMenuEvent.value = undefined;
}

function toggleSelection(values: string[], value: string, checked: boolean): string[] {
    if (checked) return values.includes(value) ? values : [...values, value];
    return values.filter(item => item !== value);
}

function toggleMessageType(type: string, event: CustomEvent<{ checked: boolean }>) {
    filterState.value.messageTypes = toggleSelection(
        filterState.value.messageTypes,
        type,
        Boolean(event.detail?.checked),
    );
    onFilterChange();
}

function toggleTag(tag: string, event: CustomEvent<{ checked: boolean }>) {
    filterState.value.tags = toggleSelection(filterState.value.tags, tag, Boolean(event.detail?.checked));
    onFilterChange();
}

const messageTypeLabels: Record<string, string> = {
    user_message: "User",
    user_message_service: "User (bot)",
    bot_message_service: "Bot",
    manager_message: "Manager",
    service_call: "Service",
    error_message: "Error",
    event: "Event",
};

function messageTypeLabel(type: string): string {
    return messageTypeLabels[type] || type.replace(/[_-]+/g, " ");
}

function selectedSummary(values: string[], emptyLabel: string): string {
    if (values.length === 0) return emptyLabel;
    if (values.length <= 2) return values.join(", ");
    return `${values.length} selected`;
}

const messageTypeSummary = computed(() => selectedSummary(
    filterState.value.messageTypes.map(messageTypeLabel),
    t("filter.none"),
));
const tagSummary = computed(() => selectedSummary(filterState.value.tags, t("filter.none")));

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
/* The inbox is a stack of deliberate surfaces rather than unmodified Ionic rows. */
.search-bar {
    padding: 10px 12px;
    background: var(--ui-surface);
}

.search-item {
    --background: var(--ui-surface-raised);
    --border-color: var(--ui-border-strong);
    --min-height: 42px;
    --padding-start: 12px;
    --padding-end: 6px;
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius-md);
    box-shadow: var(--ui-shadow-soft);
}

.search-item::part(native) {
    min-height: 42px;
    padding: 0 6px 0 12px;
}

.filter-bar {
    margin: 0 12px 12px;
    padding: 12px;
    background: var(--ui-surface-raised);
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius-lg);
    box-shadow: var(--ui-shadow-soft);
}

.filter-label {
    color: var(--ui-text-muted);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
}

.filter-clear {
    align-self: end;
    min-height: 36px;
    padding: 0 10px;
    color: var(--ion-color-primary);
    background: transparent;
    border: 1px solid var(--ui-border-strong);
    border-radius: 999px;
    font: inherit;
    font-size: 11px;
    cursor: pointer;
}

.filter-clear:hover,
.filter-clear:focus-visible {
    background: var(--ion-color-primary-tint);
    outline: none;
}

.filter-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 72px auto;
    gap: 8px;
}

.filter-field {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 5px;
}

.filter-trigger,
.filter-field ion-input {
    --background: var(--ui-surface);
    --highlight-color-focused: var(--ion-color-primary);
    --min-height: 36px;
    min-height: 36px;
    width: 100%;
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius-sm);
    color: var(--ui-text);
    font-size: 13px;
}

.filter-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 0 8px 0 9px;
    background: var(--ui-surface);
    text-align: left;
    cursor: pointer;
}

.filter-trigger-summary {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.filter-field ion-input::part(native) {
    min-height: 34px;
    padding: 0 9px;
}

.filter-trigger:hover,
.filter-field ion-input:hover,
.filter-trigger:focus-visible,
.filter-field ion-input:focus-within {
    border-color: var(--ion-color-primary);
    outline: none;
}

.filter-options-list {
    min-width: 220px;
    max-height: 300px;
    overflow: auto;
    padding: 6px;
    background: var(--ui-surface-raised);
}

.filter-options-list ion-item {
    --min-height: 36px;
    --padding-start: 8px;
    --inner-padding-end: 8px;
    --background: transparent;
    border-radius: var(--ui-radius-sm);
}

.filter-options-list ion-item:hover {
    --background: var(--ui-primary-surface);
}

.filter-options-list ion-checkbox {
    margin-inline-end: 8px;
}

.filter-empty-options {
    color: var(--ui-text-muted);
    font-size: 12px;
}

.chat-list ion-item {
    --background: transparent;
    --inner-border-width: 0;
    --min-height: 68px;
    --padding-start: 12px;
    --padding-end: 12px;
    margin: 4px 8px;
    border: 1px solid transparent;
    border-radius: var(--ui-radius-md);
    transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
}

.chat-list ion-item::part(native) {
    min-height: 68px;
    padding: 10px 12px;
    border-radius: var(--ui-radius-md);
}

.chat-list ion-item:not(.active):hover {
    --background: var(--ui-surface-raised);
    border-color: var(--ui-border);
}

.chat-list ion-item:active {
    transform: scale(0.985);
}

.chat-list ion-item.active {
    --background: var(--ui-primary-surface);
    --color: var(--ui-text);
    border-color: var(--ui-primary-border);
    box-shadow: var(--ui-shadow-soft);
}

.chat-list ion-item.active ion-label h3 {
    font-weight: 750;
}

/* Avatar circle with first letter */
.avatar {
    width: 38px;
    height: 38px;
    border-radius: 12px;
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
    margin: 4px 0 0;
    color: var(--ui-text-muted);
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.empty-list {
    margin: 8px;
    padding: 28px 16px;
    color: var(--ui-text-muted);
    background: var(--ui-surface-raised);
    border: 1px dashed var(--ui-border-strong);
    border-radius: var(--ui-radius-md);
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

.clear-btn {
    margin-left: 4px;
}

/* Name and username styling */
.name {
    font-weight: 700;
    color: var(--ui-text);
}

.ion-palette-dark .name {
    color: #f9fafb;
}

.username {
    font-weight: 700;
    color: var(--ui-text-muted);
    font-size: 0.9em;
}

.ion-palette-dark .username {
    color: #d1d5db;
}

/* Time styling in chat list */
ion-note {
    color: var(--ui-text-muted);
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

@media (max-width: 460px) {
    .filter-grid {
        grid-template-columns: minmax(0, 1fr) minmax(0, 0.8fr);
    }

    .filter-field-type,
    .filter-field-tags {
        grid-column: 1 / -1;
    }

    .filter-clear {
        grid-column: 2;
    }
}
</style>
