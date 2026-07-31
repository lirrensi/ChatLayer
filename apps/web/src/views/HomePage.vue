<!--
FILE: apps/web/src/views/HomePage.vue
PURPOSE: Compose the responsive inbox, bot switcher, and conversation workspace.
OWNS: Desktop split layout, mobile chat modal, bot navigation, and workspace-level styling.
EXPORTS: HomePage — primary manager workspace view.
DOCS: .agents/reports/plan_chat-ui-redesign_2026-07-31.md
-->
<template>
    <ion-page>
        <ion-header :translucent="true">
            <ion-toolbar>
                <ion-title>{{ $t("app.title") }}</ion-title>
                <ion-buttons slot="end">
                    <ion-button
                        fill="clear"
                        @click="openSettings"
                        :aria-label="$t('settings.title')"
                    >
                        <ion-icon :icon="settingsOutline" />
                    </ion-button>
                    <LanguagePicker />
                </ion-buttons>
            </ion-toolbar>
        </ion-header>

        <ion-content :fullscreen="true">
            <!-- Deeplink loading indicator -->
            <ion-loading
                :is-open="isDeeplinkLoading"
                message="Navigating to chat..."
            />
            
            <!-- Error/Success toast messages -->
            <ion-toast
                :is-open="showToast"
                :message="toastMessage"
                :duration="3000"
                @didDismiss="showToast = false"
                :color="deeplinkError ? 'danger' : 'success'"
            />
            <div class="layout">
                <aside
                    class="left"
                    :style="leftStyle"
                >
                    <div class="controls">
                        <div class="bot-switcher-header">
                            <span class="workspace-kicker">{{ $t("app.title") }}</span>
                            <ion-button
                                size="small"
                                fill="clear"
                                @click="refresh"
                                :aria-label="$t('home.refresh_bots_aria')"
                                class="bots-refresh"
                            >
                                <ion-icon :icon="refreshOutline" />
                            </ion-button>
                        </div>
                        <div class="bot-tabs">
                            <div class="tabs-list" aria-label="Bot selection">
                                <ion-button
                                    v-for="b in bots"
                                    :key="b"
                                    size="small"
                                    :fill="'outline'"
                                    :class="{ selected: selectedBotId === b }"
                                    @click="onSelectBot(b)"
                                >
                                    {{ b }}
                                </ion-button>
                            </div>
                        </div>
                    </div>

                    <ChatList
                        :rooms="rooms"
                        :messages="filteredMessages || []"
                        :selectedRoomId="selectedRoomId"
                        :selectedBotId="selectedBotId"
                        @select-room="onSelectRoom"
                    />
                </aside>
                <div
                    v-if="!isMobile"
                    class="resizer"
                    @mousedown="onResizeStart"
                ></div>

                <main class="right">
                    <div
                        v-if="isMobile && !selectedRoomId"
                        class="mobile-hint"
                    >
                        <p>{{ $t("home.select_chat_hint") }}</p>
                    </div>

                    <div
                        v-if="!isMobile"
                        class="chat-container"
                    >
                        <div
                            class="mobile-top"
                            v-if="isMobile"
                        >
                            <ion-button
                                fill="clear"
                                @click="onBack"
                                v-if="selectedRoomId"
                                >{{ $t("home.back") }}</ion-button
                            >
                            <div class="room-title">{{ selectedRoomId || $t("chat.header.all_messages") }}</div>
                        </div>

                        <ChatView
                            :messages="messages || []"
                            :roomId="selectedRoomId || undefined"
                            @send-message="onSendMessage"
                            @refresh="refresh"
                            @load-more="onLoadMore"
                        />
                    </div>
                </main>
            </div>
            <ion-modal
                :is-open="isMobile && !!selectedRoomId"
                @didDismiss="onBack"
            >
                <div class="mobile-chat-modal">
                    <div class="mobile-top">
                        <ion-button
                            fill="clear"
                            @click="onBack"
                            >{{ $t("home.back") }}</ion-button
                        >
                        <div class="room-title">{{ selectedRoomId || $t("chat.header.all_messages") }}</div>
                    </div>
                    <div class="chat-container">
                        <ChatView
                            :messages="messages || []"
                            :roomId="selectedRoomId || undefined"
                            @send-message="onSendMessage"
                            @refresh="refresh"
                            @load-more="onLoadMore"
                        />
                    </div>
                </div>
            </ion-modal>
            
            <SettingsModal
                :is-open="isSettingsOpen"
                @dismiss="closeSettings"
            />
        </ion-content>
    </ion-page>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref, watch, watchEffect } from "vue";
import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButton, IonIcon, IonModal, IonLoading, IonToast } from "@ionic/vue";
import { refreshOutline, settingsOutline } from "ionicons/icons";
import ChatList from "../components/ChatList.vue";
import ChatView from "../components/ChatView.vue";
import LanguagePicker from "../components/LanguagePicker.vue";
import SettingsModal from "../components/SettingsModal.vue";
import { Botoraptor } from "../../../../sdk-templates/node/botoraptor.ts";
import { getApiKey } from "../services/api";
import { useUiStore } from "../stores/uiStore";
import { useRoute } from "vue-router";
import { parseHash, buildHash } from "../utils/hashParser";
import { useI18n } from "vue-i18n";

import { storeToRefs } from "pinia";
const { t } = useI18n();
const ui = useUiStore();
const route = useRoute();
// use storeToRefs so template gets stable refs for state and getters
const { bots, rooms, messages, selectedBotId, selectedRoomId, filteredMessages } = storeToRefs(ui);

// Deeplink navigation state
const isDeeplinkLoading = ref(false);
const deeplinkError = ref<string | null>(null);
const showToast = ref(false);
const toastMessage = ref('');
const hasProcessedInitialDeeplink = ref(false);

// Navigation history for back/forward support
const navigationHistory = ref<Array<{botId: string, userId?: string, timestamp: number}>>([]);
const currentHistoryIndex = ref(-1);

// Settings modal state
const isSettingsOpen = ref(false);

function openSettings() {
    isSettingsOpen.value = true;
}

function closeSettings() {
    isSettingsOpen.value = false;
}

const windowWidth = ref<number>(window.innerWidth);
const isMobile = computed(() => windowWidth.value < 800);

watchEffect(() => {
    document.title = t("app.title");
});

const leftWidthPx = ref<number>(320);
const isDragging = ref(false);
const startX = ref(0);
const startWidth = ref(320);
const MIN_LEFT = 320;
const MAX_LEFT = 560;

const leftStyle = computed(() => {
    if (isMobile.value) return { width: "100%" };
    return { width: `${leftWidthPx.value}px` };
});

function clamp(n: number, min: number, max: number) {
    return Math.min(max, Math.max(min, n));
}

function loadLeftWidth() {
    try {
        const raw = localStorage.getItem("ui.leftWidthPx");
        const n = raw ? parseInt(raw, 10) : MIN_LEFT;
        leftWidthPx.value = clamp(isNaN(n) ? MIN_LEFT : n, MIN_LEFT, MAX_LEFT);
    } catch {
        leftWidthPx.value = MIN_LEFT;
    }
}

function saveLeftWidth(n: number) {
    try {
        localStorage.setItem("ui.leftWidthPx", String(n));
    } catch {}
}

function onResizeStart(e: MouseEvent) {
    if (isMobile.value) return;
    isDragging.value = true;
    startX.value = e.clientX;
    startWidth.value = leftWidthPx.value;
    try {
        document.body.style.cursor = "col-resize";
    } catch {}
}

function onMouseMove(e: MouseEvent) {
    if (!isDragging.value || isMobile.value) return;
    const dx = e.clientX - startX.value;
    const next = clamp(startWidth.value + dx, MIN_LEFT, MAX_LEFT);
    if (next !== leftWidthPx.value) {
        leftWidthPx.value = next;
        saveLeftWidth(next);
    }
}

function onMouseUp() {
    if (!isDragging.value) return;
    isDragging.value = false;
    try {
        document.body.style.cursor = "default";
    } catch {}
}

function onWindowResize() {
    windowWidth.value = window.innerWidth;
    // keep stored width clamped in desktop; sidebar resizing disabled in mobile (<800px)
    if (!isMobile.value) {
        leftWidthPx.value = clamp(leftWidthPx.value, MIN_LEFT, MAX_LEFT);
    }
}

function onIonBackButton(ev: any) {
    try {
        // Register back action with higher priority (10) to dismiss modal when open
        ev.detail.register(10, () => {
            if (isMobile.value && ui.selectedRoomId) {
                onBack();
            }
        });
    } catch {}
}

function onSelectRoom(roomId: string) {
    ui.selectRoom(roomId);
}

function onBack() {
    ui.selectedRoomId = undefined;
}

async function onSendMessage(payload: { roomId?: string; text: string; attachments?: any[] }) {
    try {
        const key = getApiKey();
        if (!key) throw new Error("API key missing");
        const chat = new Botoraptor({ apiKey: key });
        await chat.addManagerMessage({
            botId: ui.selectedBotId || (ui.messages[0] && ui.messages[0].botId) || "test-bot",
            roomId: payload.roomId || ui.selectedRoomId || "default",
            userId: "manager",
            text: payload.text,
            messageType: "manager_message",
            attachments: payload.attachments ?? undefined,
        });
        await ui.refresh();
    } catch (err) {
        console.error("Failed to send message", err);
    }
}

async function onLoadMore(payload: { roomId?: string; cursorId?: number | string; types?: string[] }) {
    const rid = payload.roomId || ui.selectedRoomId || undefined;
    if (!rid) return;
    await ui.loadOlderMessages(rid, payload.cursorId, payload.types);
}

function onSelectBot(botId: string) {
    void ui.selectBot(botId);
}

async function refresh() {
    await ui.refresh();
}

// Handle deeplink navigation
async function handleDeeplinkNavigation(botId: string, userId?: string) {
    if (!botId) return;
    
    isDeeplinkLoading.value = true;
    deeplinkError.value = null;
    
    try {
        // Wait for bots to be loaded if not already
        if (bots.value.length === 0) {
            await ui.loadBots();
        }
        
        // Check if bot exists
        if (!bots.value.includes(botId)) {
            throw new Error(`Bot "${botId}" not found`);
        }
        
        // Select the bot
        await ui.selectBot(botId);
        
        // If userId provided, find and select the corresponding room
        if (userId) {
            // Wait for rooms to be loaded
            if (rooms.value.length === 0) {
                // Rooms should be loaded by selectBot, but wait a bit if needed
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            
            // Find room by userId
            const targetRoom = rooms.value.find(room => {
                const user = room.users?.[0];
                return user?.userId === userId || user?.userId === userId || room.roomId === userId;
            });
            
            if (targetRoom) {
                await ui.selectRoom(targetRoom.roomId);
            } else {
                // Room not found, show error but keep bot selected
                throw new Error(`Chat for "${userId}" not found`);
            }
        }
        
        // Show success message
        toastMessage.value = userId
            ? `Navigated to ${botId}/${userId}`
            : `Navigated to ${botId}`;
        showToast.value = true;
        
    } catch (error) {
        console.error('Deeplink navigation error:', error);
        deeplinkError.value = error instanceof Error ? error.message : 'Failed to navigate';
        toastMessage.value = deeplinkError.value;
        showToast.value = true;
    } finally {
        isDeeplinkLoading.value = false;
    }
}

// Navigation history functions
function addToHistory(botId: string, userId?: string) {
    const entry = { botId, userId, timestamp: Date.now() };
    
    // Remove any entries after current index if we're not at the end
    if (currentHistoryIndex.value < navigationHistory.value.length - 1) {
        navigationHistory.value = navigationHistory.value.slice(0, currentHistoryIndex.value + 1);
    }
    
    // Add new entry
    navigationHistory.value.push(entry);
    currentHistoryIndex.value = navigationHistory.value.length - 1;
    
    // Limit history size to prevent memory issues
    if (navigationHistory.value.length > 50) {
        navigationHistory.value.shift();
        currentHistoryIndex.value--;
    }
}

function replaceHashInBrowser(hash: string) {
    const normalizedHash = hash.startsWith('#') ? hash : `#${hash}`;
    const baseUrl = `${window.location.pathname}${window.location.search}`;
    if (window.location.hash !== normalizedHash) {
        history.replaceState(null, '', `${baseUrl}${normalizedHash}`);
    }
}

function navigateHistory(direction: 'back' | 'forward') {
    const newIndex = direction === 'back'
        ? currentHistoryIndex.value - 1
        : currentHistoryIndex.value + 1;
    
    if (newIndex >= 0 && newIndex < navigationHistory.value.length) {
        const entry = navigationHistory.value[newIndex];
        currentHistoryIndex.value = newIndex;
        
        // Navigate without adding to history
        const hash = buildHash(entry.botId, entry.userId);
        replaceHashInBrowser(hash);
        
        // Update selections
        if (entry.botId !== selectedBotId.value) {
            ui.selectBot(entry.botId);
        }
        if (entry.userId && entry.userId !== selectedRoomId.value) {
            // Find room by userId
            const targetRoom = rooms.value.find(room => {
                const user = room.users?.[0];
                return user?.userId === entry.userId || user?.userId === entry.userId || room.roomId === entry.userId;
            });
            if (targetRoom) {
                ui.selectRoom(targetRoom.roomId);
            }
        }
    }
}

// Update URL when bot or room selection changes
function updateUrl() {
    if (selectedBotId.value) {
        // Find userId for selected room
        let userId: string | undefined;
        if (selectedRoomId.value) {
            const room = rooms.value.find(r => r.roomId === selectedRoomId.value);
            const user = room?.users?.[0];
            const displayName = user?.userId || user?.userId || selectedRoomId.value;
            userId = displayName;
        }
        
        // Use the /home/bot/userId format to avoid double hash
        const hash = buildHash(selectedBotId.value, userId);
        replaceHashInBrowser(hash);
        
        // Add to navigation history
        addToHistory(selectedBotId.value, userId);
    }
}

// Watch for route changes to handle deeplinks
watch(
    [() => route.name, () => route.params.botId, () => route.params.userId],
    async ([routeName, botId, userId]) => {
        // Only process deeplinks on initial page load
        if (!hasProcessedInitialDeeplink.value && botId && typeof botId === 'string') {
            hasProcessedInitialDeeplink.value = true;
            await handleDeeplinkNavigation(botId, userId as string);
        }
    },
    { immediate: true }
);

// Watch for manual navigation to update URL
watch([selectedBotId, selectedRoomId], () => {
    // Only update URL if not currently processing a deeplink and not initial load
    if (!isDeeplinkLoading.value && hasProcessedInitialDeeplink.value) {
        updateUrl();
    }
}, { deep: true });

onMounted(() => {
    void ui.init();
    loadLeftWidth();
    window.addEventListener("resize", onWindowResize);
    window.addEventListener("mousemove", onMouseMove as any);
    window.addEventListener("mouseup", onMouseUp as any);
    // Support Ionic back action to dismiss modal when open (mobile-like UX)
    window.addEventListener("ionBackButton", onIonBackButton as any);
    
    // Add keyboard shortcuts for navigation history
    window.addEventListener("keydown", (e: KeyboardEvent) => {
        // Alt+Left Arrow for back
        if (e.altKey && e.key === "ArrowLeft") {
            e.preventDefault();
            navigateHistory('back');
        }
        // Alt+Right Arrow for forward
        if (e.altKey && e.key === "ArrowRight") {
            e.preventDefault();
            navigateHistory('forward');
        }
    });
    
    // Initialize navigation history with current state after a delay
    // to ensure we don't interfere with initial deeplink processing
    setTimeout(() => {
        if (selectedBotId.value) {
            let userId: string | undefined;
            if (selectedRoomId.value) {
                const room = rooms.value.find(r => r.roomId === selectedRoomId.value);
                const user = room?.users?.[0];
                const displayName = user?.userId || user?.userId || selectedRoomId.value;
                userId = displayName;
            }
            addToHistory(selectedBotId.value, userId);
        }
        // Mark that we've processed any initial deeplink
        hasProcessedInitialDeeplink.value = true;
    }, 1000);
});

onUnmounted(() => {
    window.removeEventListener("resize", onWindowResize);
    window.removeEventListener("mousemove", onMouseMove as any);
    window.removeEventListener("mouseup", onMouseUp as any);
    window.removeEventListener("ionBackButton", onIonBackButton as any);
});
</script>

<style scoped>
.layout {
    display: flex;
    height: 100%;
    min-width: 0;
    background: var(--ui-canvas);
}

/* left column */
.left {
    min-width: 320px;
    padding: 14px 0;
    background: var(--ui-surface);
    border-right: 1px solid var(--ui-border);
    box-sizing: border-box;
    overflow: auto;
    flex: 0 0 auto;
}

/* right column */
.right {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    min-width: 0;
    background: var(--ui-canvas);
}

/* vertical resizer between left and right (desktop only) */
.resizer {
    width: 6px;
    flex: 0 0 6px;
    cursor: col-resize;
    background: transparent;
    transition: background-color 0.15s ease;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
}
.resizer::after {
    content: "";
    width: 2px;
    height: 24px;
    border-radius: 1px;
    background: var(--ion-color-medium);
    opacity: 0;
    transition: opacity 0.15s ease;
}
.resizer:hover {
    background: rgba(0, 0, 0, 0.05);
}
.resizer:hover::after {
    opacity: 0.4;
}

/* Dark mode resizer */
.ion-palette-dark .resizer:hover {
    background: rgba(255, 255, 255, 0.05);
}

/* ensure chat container fills column and keeps internal scrolling behavior */
.chat-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
}

.controls {
    margin: 0 12px 12px;
    padding: 12px;
    background: var(--ui-surface-raised);
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius-lg);
    box-shadow: var(--ui-shadow-soft);
}

.bot-switcher-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 10px;
}

.workspace-kicker {
    color: var(--ui-text-muted);
    font-size: 10px;
    font-weight: 850;
    letter-spacing: 0.1em;
    text-transform: uppercase;
}

.bot-tabs {
    min-width: 0;
}

.tabs-list {
    display: flex;
    gap: 6px;
    min-width: 0;
    overflow-x: auto;
    padding-bottom: 2px;
    scrollbar-width: thin;
}

.tabs-list ion-button {
    --border-radius: var(--ui-radius-sm);
    --border-color: var(--ui-border-strong);
    --color: var(--ui-text-muted);
    --padding-start: 12px;
    --padding-end: 12px;
    flex: 0 0 auto;
    margin: 0;
    transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.1s ease;
}

.tabs-list ion-button:hover {
    --background: var(--ui-primary-surface);
    --color: var(--ion-color-primary);
    transform: translateY(-1px);
}

.tabs-list ion-button.selected {
    --background: var(--ion-color-primary);
    --background-hover: var(--ion-color-primary-shade);
    --color: var(--ion-color-primary-contrast);
    --border-color: var(--ion-color-primary);
    font-weight: 750;
}

.bots-refresh {
    --color: var(--ui-text-muted);
    --border-radius: var(--ui-radius-sm);
    margin: 0;
}

.bots-refresh:hover,
.bots-refresh:focus-visible {
    --background: var(--ui-primary-surface);
    --color: var(--ion-color-primary);
}

/* mobile behavior */
@media (max-width: 799px) {
    .layout {
        flex-direction: column;
    }
    .left {
        width: 100%;
        border-right: none;
        border-bottom: 1px solid var(--ion-color-light-tint);
    }
    .right {
        padding: 0;
    }
    .chat-container {
        /* height: calc(100vh - 170px); */
        display: flex;
        flex-direction: column;
    }
    .mobile-top {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px;
        border-bottom: 1px solid var(--ion-color-light-tint);
    }
}

.mobile-hint {
    margin: 20px;
    padding: 32px 24px;
    color: var(--ui-text-muted);
    background: var(--ui-surface-raised);
    border: 1px dashed var(--ui-border-strong);
    border-radius: var(--ui-radius-lg);
    text-align: center;
}

.mobile-chat-modal {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--ui-canvas);
}
</style>
