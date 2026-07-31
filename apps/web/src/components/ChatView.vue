<!--
FILE: apps/web/src/components/ChatView.vue
PURPOSE: Render the filtered conversation timeline and provide the attachment-aware composer.
OWNS: Message semantics, event activity blocks, message tags, pagination, quick replies, and sending.
EXPORTS: ChatView — responsive conversation canvas and composer.
DOCS: .agents/reports/plan_ui-filter-placement_2026-07-31.md
-->
<template>
    <div class="chat-view">
        <!-- NOTE: header here a bit redundant but keep for maybe later functionality -->
        <!-- <div class="header">
            <h3>{{ roomTitle }}</h3>
            <div class="header-actions">
                <ion-button
                    size="small"
                    fill="clear"
                    @click="refresh"
                    >{{ $t("chat.refresh") }}</ion-button
                >
            </div>
        </div> -->
        
        <div class="filter-bar" aria-label="Message filters">
            <div class="filter-field filter-field-type">
                <span class="filter-label">{{ $t('filter.messageTypes') }}</span>
                <button
                    id="cv-message-type-filter-trigger"
                    type="button"
                    class="filter-trigger"
                    :aria-label="$t('filter.messageTypes')"
                    aria-haspopup="dialog"
                    @click="toggleFilterMenu('messageTypes', $event)"
                >
                    <span class="filter-trigger-summary">{{ messageTypesSummary }}</span>
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
                                :checked="messageFilter.messageTypes.includes(type)"
                                @ionChange="toggleMessageType(type, $event)"
                            />
                            <ion-label>{{ formatTypeLabel(type) }}</ion-label>
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
                    id="cv-tag-filter-trigger"
                    type="button"
                    class="filter-trigger"
                    :aria-label="$t('filter.tags')"
                    aria-haspopup="dialog"
                    @click="toggleFilterMenu('tags', $event)"
                >
                    <span class="filter-trigger-summary">{{ tagsSummary }}</span>
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
                                :checked="messageFilter.tags.includes(tag)"
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
        </div>

        <div
            class="messages"
            ref="messagesEl"
        >
            <!-- Error banner for failed message loads -->
            <div
                v-if="messagesError"
                class="messages-error"
            >
                <span class="error-text">{{ messagesError }}</span>
                <button class="error-retry" @click="refresh">Retry</button>
                <button class="error-dismiss" @click="dismissError">✕</button>
            </div>

            <div
                v-if="loadingMore"
                class="loading-top"
            >
                <ion-spinner name="dots" />
            </div>

            <!-- Loading skeleton when messages are loading for the first time -->
            <div
                v-if="isLoadingMessages && filteredMessages.length === 0"
                class="message-skeleton"
            >
                <div
                    v-for="n in 5"
                    :key="'msg-skel-' + n"
                    class="msg-skel-bubble"
                    :class="n % 2 === 0 ? 'msg-skel-right' : 'msg-skel-left'"
                >
                    <div class="msg-skel-line msg-skel-line-1" />
                    <div class="msg-skel-line msg-skel-line-2" />
                </div>
            </div>

            <div
                v-else-if="filteredMessages.length === 0 && !isLoadingMessages"
                class="empty"
            >
                <div class="empty-icon">💬</div>
                <div class="empty-msg">{{ $t("chat.no_messages") }}</div>
                <div class="empty-sub">{{ $t("home.select_chat_hint") }}</div>
            </div>

            <div
                v-for="m in filteredMessages"
                :key="m.id || m.createdAt"
                :class="['message', isCenter(m) ? 'center event-message' : isLeft(m) ? 'left' : 'right', isAutoMessage(m) ? 'auto-message' : '']"
                :data-type="m.messageType || 'text'"
            >
                <div v-if="isCenter(m)" class="event-heading">
                    <span class="event-marker" aria-hidden="true">✦</span>
                    <span class="event-label">{{ getMessageTypeLabel(m) }}</span>
                    <span class="event-rule" aria-hidden="true"></span>
                </div>
                <div v-else class="annotation">{{ getMessageTypeLabel(m) }}</div>
                <!-- NOTE: as for not we support 1-1 chats only, assume user is same always -->
                <!-- <div class="meta">
                    <strong>{{ m.username || m.userId || "user" }}</strong>
                </div> -->
                <div class="body">
                    <!-- files first, then text -->
                    <div
                        v-if="m.attachments && m.attachments.length"
                        class="attachments"
                    >
                        <div
                            v-for="(a, idx) in m.attachments"
                            :key="(a.filename || a.url) + '_' + idx"
                            class="attachment"
                            :class="{ 'has-preview': a.type === 'image' || a.type === 'video' }"
                        >
                            <!-- Warning for dangerous file extensions -->
                            <ion-chip
                                v-if="isDangerousFile(a.filename || a.file_name)"
                                color="warning"
                                class="dangerous-file-warning"
                            >
                                <ion-icon :icon="warningOutline"></ion-icon>
                                <ion-label>Potentially dangerous file</ion-label>
                            </ion-chip>

                            <template v-if="a.type === 'image'">
                                <img
                                    :src="getAttachmentUrl(a)"
                                    class="attachment-preview image"
                                    @error="onPreviewError($event, a)"
                                />
                            </template>

                            <template v-else-if="a.type === 'video'">
                                <video
                                    :src="getAttachmentUrl(a)"
                                    class="attachment-preview video"
                                    controls
                                    @error="onPreviewError($event, a)"
                                ></video>
                            </template>

                            <template v-else>
                                <template v-if="a.type === 'document'">
                                    <div class="attachment-doc"><ion-icon :icon="documentOutline"></ion-icon></div>
                                </template>
                                <template v-else>
                                    <div class="attachment-doc">📄</div>
                                </template>
                            </template>

                            <div class="attachment-meta">
                                <a
                                    :href="getAttachmentUrl(a)"
                                    :download="getAttachmentFileName(a) || undefined"
                                    class="attachment-download"
                                    @click.prevent="downloadAttachment(a)"
                                    :title="getAttachmentFileName(a) || a.url"
                                >
                                    {{ truncateFileName(getAttachmentFileName(a) || "file") }}
                                    <span
                                        class="download-icon"
                                        title="Download"
                                        >⬇</span
                                    >
                                </a>
                                <span class="attachment-size">{{ formatSize(a.size) }}</span>
                                <span
                                    v-if="a._error"
                                    class="attachment-error"
                                >
                                    (unavailable)</span
                                >
                            </div>
                        </div>
                    </div>

                    <div
                        v-if="m.text"
                        class="message-text"
                    >
                        <Highlighter
                            v-if="isSearchActive && searchTokens.length"
                            :searchWords="searchTokens"
                            :autoEscape="true"
                            :textToHighlight="m.text"
                            highlightClassName="hl"
                        />
                        <template v-else>{{ m.text }}</template>
                    </div>

                    <div v-if="messageTags(m).length" class="message-tags">
                        <span v-for="tag in messageTags(m)" :key="tag" class="tag-chip">{{ tag }}</span>
                    </div>
                </div>

                <div class="time-indicator">{{ formatTime(m.createdAt) }}</div>
            </div>
        </div>

        <!-- Quick responses content positioned before composer -->
        <div
            class="composer"
            @drop.prevent="onDrop"
            @dragover.prevent
        >
            <div
                v-if="showQuickResponses && quickAnswers.length > 0"
                class="quick-responses-container"
            >
                <div class="quick-responses-scroller" @wheel="handleQuickResponsesWheel">
                    <div class="quick-responses">
                        <div
                            class="quick-response-card"
                            v-for="answer in quickAnswers"
                            :key="answer"
                            @click="sendQuickResponse(answer)"
                        >
                            {{ answer }}
                        </div>
                    </div>
                </div>
            </div>
            <div
                class="pending-attachments"
                v-if="pendingFiles.length"
            >
                <div
                    v-for="(p, i) in pendingFiles"
                    :key="p.id || i"
                    class="pending"
                >
                    <span
                        class="name"
                        :title="p.file.name"
                        >{{ truncateFileName(p.file.name) }}</span
                    >
                    <span class="size">{{ formatSize(p.file.size) }}</span>
                    <button
                        class="remove"
                        @click="removePending(i)"
                        title="Remove"
                    >
                        ✕
                    </button>
                    <span
                        v-if="p.state === 'uploading'"
                        class="status"
                        >Uploading...</span
                    >
                    <span
                        v-if="p.state === 'error'"
                        class="status error"
                        >Upload failed</span
                    >
                </div>
            </div>

            <ion-item lines="none">
                <input
                    ref="fileInput"
                    type="file"
                    multiple
                    style="display: none"
                    @change="onFileInput"
                />
                
                <!-- Quick responses toggle button positioned before the file button -->
                <div class="quick-responses-toggle" @click="toggleQuickResponses" style="margin-right: 8px;">
                    <ion-icon :icon="showQuickResponses ? chevronUpOutline : chevronDownOutline"></ion-icon>
                </div>
                
                <button
                    class="upload-btn"
                    @click="triggerFileSelect"
                    title="Attach file"
                >
                    ＋
                </button>

                <textarea
                    ref="textInput"
                    v-model="text"
                    :placeholder="$t('chat.type_placeholder')"
                    @keyup.enter="onSend"
                    @keydown="onKeydown"
                    @focus="onInputFocus"
                    @blur="onInputBlur"
                    @input="autoResize"
                    class="message-input"
                    rows="1"
                ></textarea>

                <ion-button
                    slot="end"
                    :disabled="!textTrim && pendingFilesDone.length === 0"
                    @click="onSend"
                    >{{ $t("chat.send") }}</ion-button
                >
            </ion-item>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onUpdated, onMounted, onBeforeUnmount, nextTick } from "vue";
import { IonButton, IonItem, IonCheckbox, IonLabel, IonIcon, IonChip, IonSpinner, IonPopover, IonList } from "@ionic/vue";
import { chevronUpOutline, chevronDownOutline, documentOutline, warningOutline } from "ionicons/icons";
import { DateTime } from "luxon";
import { useI18n } from "vue-i18n";
import { getApiKey } from "../services/api";
import Highlighter from "vue-highlight-words";
import { useUiStore } from "../stores/uiStore";
import { getEntityTags } from "../stores/uiStore";
import { storeToRefs } from "pinia";
const { t, locale } = useI18n();
const uiStore = useUiStore();
const { isLoadingMessages, messagesError, messageFilter } = storeToRefs(uiStore);
const isSearchActive = computed(() => uiStore.isSearchActive);
const searchTokens = computed(() => (uiStore.searchTokens as string[]) || []);

// Get quick answers from store
const quickAnswers = computed(() => uiStore.getQuickAnswers || []);

// Quick responses toggle state
const showQuickResponses = ref(true);

// Dangerous extensions from client config (loaded via API)
const dangerousExtensions = ref<string[]>([]);

// Check if filename has dangerous extension
function isDangerousFile(filename: string | undefined): boolean {
    if (!filename || dangerousExtensions.value.length === 0) return false;
    const ext = filename.toLowerCase().substring(filename.lastIndexOf("."));
    return dangerousExtensions.value.includes(ext);
}

type Attachment = {
    type: "image" | "video" | "document" | "file";
    url: string;
    file_name?: string;
    mime_type?: string;
    size?: number;
    createdAt?: string | Date;
    // internal UI flag
    _error?: boolean;
};

const props = defineProps<{
    messages: Array<any>;
    roomId?: string | undefined;
}>();

const sendQuickResponse = (quickText: string) => {
    // Instead of sending immediately, append the text to the input field
    if (text.value) {
        text.value += ' ' + quickText;
    } else {
        text.value = quickText;
    }
    // Focus the input after inserting text
    textInput.value?.focus?.();
    // Auto-resize the textarea after inserting text
    nextTick(() => {
        autoResize();
    });
};

const toggleQuickResponses = () => {
    showQuickResponses.value = !showQuickResponses.value;
};

const emit = defineEmits<{
    (e: "send-message", payload: { roomId?: string | undefined; text: string; attachments?: Attachment[] }): void;
    (e: "refresh"): void;
    (
        e: "load-more",
        payload: { roomId?: string | undefined; cursorId?: string | number | undefined },
    ): void;
}>();

const text = ref("");
const messagesEl = ref<HTMLElement | null>(null);

// Pending file upload entries
const pendingFiles = ref<
    Array<{
        id: string;
        file: File;
        state: "uploading" | "done" | "error";
        attachment?: Attachment;
        error?: string;
    }>
    >([]);

const inputFocused = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const textInput = ref<any>(null);

const loadingMore = ref(false);
const prevScrollHeight = ref<number | null>(null);
const prevScrollTop = ref<number | null>(null);
const atBottom = ref(true);
const lastCursorIdRequested = ref<string | number | null>(null);
const lastLoadEmittedAt = ref<number>(0);
function formatTime(value: string | Date | undefined) {
    if (!value) return "";
    try {
        // create a Luxon DateTime from ISO/string or JS Date
        const dt = typeof value === "string" ? DateTime.fromISO(value) : DateTime.fromJSDate(new Date(value));
        if (!dt.isValid) return "";

        // runtime locale may be like "en" or "en_US" - derive language part for Luxon
        let runLocale = "en";
        try {
            const rl: any = locale;
            const raw = rl && typeof rl.value !== "undefined" ? rl.value : rl;
            if (typeof raw === "string" && raw.length) {
                runLocale = String(raw).split(/[_-]/)[0];
            }
        } catch {}

        // set locale and return relative time string (e.g., "3 minutes ago", localized)
        // toRelative returns null on failure, so fallback to empty string
        return dt.setLocale(runLocale).toRelative({ base: DateTime.now() }) || "";
    } catch {
        return "";
    }
}

/**
 * roomTitle: prefer username (if any message for this room has username) => userId => roomId
 */
const roomTitle = computed(() => {
    if (!props.roomId) return t("chat.header.all_messages");
    const m = (props.messages || []).find(x => x.roomId === props.roomId) || (props.messages && props.messages[0]);
    if (m) {
        return m.username || m.userId || props.roomId;
    }
    return props.roomId;
});

// Timeline filter pickers: options come from the complete-database filter lists,
// selections live in uiStore.messageFilter, and any change refetches from the DB.
const filterOptions = computed(() => uiStore.filterOptions);

const openFilterMenu = ref<"messageTypes" | "tags" | null>(null);
const filterMenuEvent = ref<Event | undefined>(undefined);

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

function selectedSummary(values: string[], emptyLabel: string): string {
    if (values.length === 0) return emptyLabel;
    if (values.length <= 2) return values.join(", ");
    return `${values.length} selected`;
}

const messageTypesSummary = computed(() => selectedSummary(
    messageFilter.value.messageTypes.map(formatTypeLabel),
    t("filter.none"),
));
const tagsSummary = computed(() => selectedSummary(messageFilter.value.tags, t("filter.none")));

// Apply the new filter: refetch from the database with a fresh timeline and
// scroll straight to the bottom.
async function applyMessageFilter() {
    if (!props.roomId) return;
    await uiStore.loadMessages(props.roomId, { reset: true });
    await nextTick();
    requestAnimationFrame(() => {
        const el = messagesEl.value;
        if (el) {
            el.scrollTop = el.scrollHeight;
            atBottom.value = true;
        }
    });
}

function toggleMessageType(type: string, event: CustomEvent<{ checked: boolean }>) {
    messageFilter.value.messageTypes = toggleSelection(
        messageFilter.value.messageTypes,
        type,
        Boolean(event.detail?.checked),
    );
    void applyMessageFilter();
}

function toggleTag(tag: string, event: CustomEvent<{ checked: boolean }>) {
    messageFilter.value.tags = toggleSelection(messageFilter.value.tags, tag, Boolean(event.detail?.checked));
    void applyMessageFilter();
}

const leftTypes = new Set(["user_message", "user_message_service", "service_call"]);
const rightTypes = new Set(["bot_message_service", "manager_message"]);

function isLeft(m: any) {
    const mt = (m && (m.messageType || "text")) as string;
    if (leftTypes.has(mt)) return true;
    if (rightTypes.has(mt)) return false;
    // fallback: messages from users (have userId) considered left
    return mt.startsWith("user") || !!m.userId;
}

function isAutoMessage(m: any) {
    const mt = (m && (m.messageType || "text")) as string;
    // treat any message type that contains "service" as an automated/auto message
    // this covers variants like "user_message_service", "bot_message_service",
    // as well as "user_service" / "bot_service" if present.
    return typeof mt === "string" && ["user_message_service", "bot_message_service"].includes(mt);
}

function isCenter(m: any) {
    return (m && m.messageType) === "event";
}

function messageTags(m: unknown): string[] {
    return getEntityTags(m);
}

function getMessageTypeLabel(m: any) {
    const mt = (m && (m.messageType || "text")) as string;
    const key = `chat.type.${mt}`;
    try {
        const res = t(key);
        // vue-i18n returns the key when missing; if it's different, use it
        if (res && res !== key) return res;
    } catch {}
    // fallback: use annotation text for plain text messages, otherwise raw type
    try {
        if (mt === "text") return t("chat.annotation.text");
    } catch {}
    return mt;
}

function formatTypeLabel(type: string) {
    try {
        const key = `chat.type.${type}`;
        const res = t(key);
        if (res && res !== key) return res as string;
    } catch {}
    return type;
}

const filteredMessages = computed(() => {
    return (props.messages || [])
        .filter(m => {
            if (props.roomId && m.roomId !== props.roomId) return false;
            return true;
        })
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
});

function formatSize(bytes?: number) {
    if (!bytes && bytes !== 0) return "";
    const b = Number(bytes);
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function triggerFileSelect() {
    try {
        fileInput.value?.click();
    } catch {}
}

function onFileInput(e: Event) {
    const target = e.target as HTMLInputElement;
    if (!target || !target.files) return;
    handleFiles(Array.from(target.files));
    // reset input so selecting same file again fires change
    target.value = "";
}

function handleFiles(files: File[] | FileList) {
    const arr = Array.from(files as any as File[]);
    for (const f of arr) {
        const id = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        pendingFiles.value.push({ id, file: f, state: "uploading" });
    }
    // start upload (upload all currently uploading and without attachment)
    uploadPending();
}

async function uploadPending() {
    // Now batch-upload all pending files in a single request.
    // Server accepts repeated "file" fields and parallel "type" / "filename" fields.
    const toUpload = pendingFiles.value.filter(p => p.state === "uploading" && !p.attachment);
    if (toUpload.length === 0) return;
    const key = getApiKey();
    const url = `/api/v1/uploadFile`;

    // Helper to infer server 'type' from MIME
    function inferType(file: File): "image" | "video" | "document" | "file" {
        const mime = file.type || "";
        const category = mime.split("/")[0];
        if (category === "image") return "image";
        if (category === "video") return "video";
        // common document types
        if (
            mime.includes("pdf") ||
            mime.includes("msword") ||
            mime.includes("officedocument") ||
            mime.includes("text") ||
            mime.includes("spreadsheet") ||
            mime.includes("presentation")
        )
            return "document";
        return "file";
    }

    // Build single FormData containing all files
    const form = new FormData();
    for (const p of toUpload) {
        const inferred = inferType(p.file);
        form.append("file", p.file, p.file.name);
        form.append("type", inferred);
        form.append("filename", p.file.name);
    }

    try {
        const res = await fetch(url, {
            method: "POST",
            headers: key ? { Authorization: `Bearer ${key}` } : undefined,
            body: form,
        });

        if (!res.ok) {
            const txt = await res.text().catch(() => "");
            // mark all as error
            for (const p of toUpload) {
                p.state = "error";
                p.error = `upload failed: ${res.status} ${res.statusText} ${txt}`;
            }
            return;
        }

        const payload = await res.json().catch(() => null);
        if (!payload || !payload.success) {
            const msg = payload?.errorMessage || "invalid_response";
            for (const p of toUpload) {
                p.state = "error";
                p.error = String(msg);
            }
            return;
        }

        // Server returns { attachments: [ ... ] } (one per uploaded file)
        const data = payload.attachments ?? payload.data ?? null;
        let attachments: Attachment[] = [];
        if (Array.isArray(data)) attachments = data as Attachment[];
        else if (data && Array.isArray((data as any).attachments))
            attachments = (data as any).attachments as Attachment[];
        else if (payload && Array.isArray((payload as any).attachments))
            attachments = payload.attachments as Attachment[];

        if (!attachments || attachments.length === 0) {
            for (const p of toUpload) {
                p.state = "error";
                p.error = "missing attachments in response";
            }
            return;
        }

        // Assign attachments back to pending files.
        // Prefer positional mapping; as a fallback try to match by filename.
        for (let i = 0; i < toUpload.length; i++) {
            const p = toUpload[i];
            let att: Attachment | undefined = attachments[i];
            if (!att) {
                // try to find by filename (file_name or url)
                att = attachments.find(a => {
                    const fname = (a.file_name || a.url || "").toString();
                    return fname && fname.includes(p.file.name);
                });
            }
            if (att) {
                p.attachment = att;
                p.state = "done";
            } else {
                p.state = "error";
                p.error = "missing attachment mapping for file";
            }
        }
    } catch (e: any) {
        for (const p of toUpload) {
            p.state = "error";
            p.error = e?.message || String(e);
        }
    }
}

function removePending(index: number) {
    try {
        pendingFiles.value.splice(index, 1);
    } catch {}
}

const pendingFilesDone = computed(() =>
    pendingFiles.value.filter(p => p.state === "done" && p.attachment).map(p => p.attachment!),
);

function onSend() {
    const t = text.value.trim();
    const attachments = pendingFilesDone.value.length ? pendingFilesDone.value : undefined;
    if (!t && !attachments) return;
    emit("send-message", { roomId: props.roomId, text: t, attachments });
    text.value = "";
    // clear uploaded pending files after sending
    pendingFiles.value = [];
}

function refresh() {
    emit("refresh");
}

function dismissError() {
    uiStore.messagesError = null;
}

function onScroll() {
    try {
        const el = messagesEl.value;
        if (!el) return;
        // update bottom detection (5px threshold for forgiving bottom detection)
        atBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight <= 5;
        // load more when at top
        if (el.scrollTop <= 2 && !loadingMore.value) {
            tryEmitLoadMore();
        }
    } catch {}
}

function tryEmitLoadMore() {
    try {
        const msgs = filteredMessages.value;
        if (!msgs || msgs.length === 0) return;
        const earliest = msgs[0];
        const cursorId = earliest?.id;
        if (!cursorId) return;
        const now = Date.now();
        // prevent duplicate rapid requests for same cursor
        if (lastCursorIdRequested.value === cursorId && now - lastLoadEmittedAt.value < 1000) return;

        const el = messagesEl.value;
        if (el) {
            prevScrollTop.value = el.scrollTop;
            prevScrollHeight.value = el.scrollHeight;
        }

        loadingMore.value = true;
        lastCursorIdRequested.value = cursorId;
        lastLoadEmittedAt.value = now;

        emit("load-more", { roomId: props.roomId, cursorId });

        // Safety timeout: if onUpdated doesn't fire within 8s (no more data, API error, etc.),
        // reset loadingMore so the user can try again instead of being stuck forever.
        setTimeout(() => {
            if (loadingMore.value) {
                loadingMore.value = false;
                prevScrollHeight.value = null;
                prevScrollTop.value = null;
            }
        }, 8000);
    } catch {}
}

// preserve scroll when loading older messages; autoscroll if user was at bottom
onUpdated(() => {
    try {
        const el = messagesEl.value;
        if (!el) return;

        if (loadingMore.value) {
            const prevH = prevScrollHeight.value ?? 0;
            const prevT = prevScrollTop.value ?? 0;
            const diff = el.scrollHeight - prevH;
            // Use requestAnimationFrame to ensure scroll adjustment happens in same frame
            requestAnimationFrame(() => {
                el.scrollTop = prevT + diff;
            });
            // reset loading state
            loadingMore.value = false;
            prevScrollHeight.value = null;
            prevScrollTop.value = null;
            return;
        }

        if (atBottom.value) {
            const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
            // Use smooth scroll only when already near the bottom (<200px away)
            if (distanceToBottom < 200) {
                el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
            } else {
                // Large jump (initial load) — instant
                el.scrollTop = el.scrollHeight;
            }
        }
    } catch {}
});

const textTrim = computed(() => !!text.value.trim());

// helpers for attachment preview / download
function getAttachmentUrl(a: Attachment) {
    // If attachment is missing, return empty
    if (!a) return "";

    // Prefer direct/signed absolute URLs returned by the server
    if (a.url && /^https?:\/\//.test(a.url)) return a.url;

    // If server provided a relative path (starts with '/'), resolve against origin
    if (a.url && a.url.startsWith("/")) return `${window.location.origin}${a.url}`;

    // If we have some url (non-http), return as-is (fallback)
    if (a.url) return a.url;

    // No usable URL available
    try {
        (a as any)._error = true;
    } catch {}

    return "";
}

function getAttachmentFileName(a: Attachment) {
    if (!a) return "";
    // Prefer server-provided metadata 'filename' (cleaned on server)
    if ((a as any).filename) return String((a as any).filename);
    // Fallback to original_name if present
    if ((a as any).original_name) return String((a as any).original_name);
    // If only url is present, try to extract filename from path (strip query)
    if (a.url) {
        try {
            const u = new URL(a.url, window.location.origin);
            const seg = u.pathname.split("/").pop();
            if (seg) return decodeURIComponent(seg);
        } catch {}
        const raw = (a.url || "").split("/").pop() || "";
        return String((raw || "").split("?")[0]);
    }
    return "";
}

/**
 * Truncate/display filename safely for UI.
 * - Keeps file extension (if present) and inserts "..." in the middle when truncated.
 * - Always limits displayed length to `max` characters (default 128).
 */
function truncateFileName(name: string, max = 128) {
    try {
        if (!name) return "";
        const n = String(name);
        if (n.length <= max) return n;
        // preserve extension
        const lastDot = n.lastIndexOf(".");
        if (lastDot > 0 && lastDot > n.length - 10) {
            // treat extension as part after last dot, but if dot near end (ext length reasonable)
            const ext = n.slice(lastDot); // includes dot
            const keep = Math.max(0, max - ext.length - 3); // 3 for "..."
            if (keep <= 0) {
                // no room for base name, show start of name truncated
                return n.slice(0, max - 3) + "...";
            }
            return n.slice(0, keep) + "..." + ext;
        }
        // no extension found or extension too long -> truncate at end
        return n.slice(0, max - 3) + "...";
    } catch {
        return name.slice(0, 128);
    }
}

/**
 * Fetch an attachment protected by auth as a blob and cache an object URL on the attachment.
 */
async function fetchAttachmentBlob(a: Attachment) {
    // Blob fetching removed: server must provide direct or signed URLs in attachment.url.
    // This function kept as a noop for compatibility with any callers.
    return;
}

/* Legacy token exchange removed.
   Server now returns direct or signed URLs in attachment.url and there is no need
   for a client-side /getFileUrl flow. This is a noop kept for compatibility. */
async function fetchTemporaryUrlForAttachment(_: Attachment) {
    return undefined;
}

function onPreviewError(_ev: Event, a: Attachment) {
    try {
        (a as any)._error = true;
    } catch {}
}

async function downloadAttachment(a: Attachment) {
    try {
        const url = getAttachmentUrl(a);
        if (!url) throw new Error("unable to obtain file url for download");

        const filename = a.file_name || getAttachmentFileName(a) || "download";

        // If same-origin (or relative), use anchor download to attempt to force download.
        // For cross-origin URLs we open in a new tab so the browser or signed URL handler can manage it.
        const sameOrigin = url.startsWith(window.location.origin) || url.startsWith("/");
        
        if (sameOrigin) {
            const link = document.createElement("a");
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
        } else {
            // open in a new tab/window for cross-origin or signed URLs
            window.open(url, "_blank", "noopener");
        }
    } catch (e) {
        console.error("download failed", e);
        try {
            (a as any)._error = true;
        } catch {}
    }
}

// drag & drop + paste handling
function onDrop(e: DragEvent) {
    try {
        const dt = e.dataTransfer;
        if (dt && dt.files && dt.files.length) {
            handleFiles(dt.files);
        }
    } catch {}
}

function onInputFocus() {
    inputFocused.value = true;
}

function onInputBlur() {
    inputFocused.value = false;
}

function handlePaste(e: ClipboardEvent) {
    if (!inputFocused.value) return;
    try {
        const items = e.clipboardData?.files;
        if (items && items.length) {
            handleFiles(items);
            e.preventDefault();
        }
    } catch {}
}

onMounted(() => {
    window.addEventListener("paste", handlePaste as any);
    const el = messagesEl.value;
    if (el) {
        el.addEventListener("scroll", onScroll as any);
        // set initial bottom state
        atBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight <= 5;
    }
    // Initialize textarea height
    nextTick(() => {
        autoResize();
    });
    // Load client config for dangerous extensions
    (async () => {
        try {
            const res = await fetch("/api/v1/getClientConfig");
            if (res.ok) {
                const data = await res.json();
                if (data && data.dangerousExtensions) {
                    dangerousExtensions.value = data.dangerousExtensions;
                }
            }
        } catch (e) {
            console.error("Failed to load client config:", e);
        }
    })();
});

onBeforeUnmount(() => {
    window.removeEventListener("paste", handlePaste as any);
    const el = messagesEl.value;
    if (el) el.removeEventListener("scroll", onScroll as any);
});

// support Ctrl/Cmd+Enter to send (useful for multiline inputs)
function onKeydown(e: KeyboardEvent) {
    try {
        if ((e.ctrlKey || e.metaKey) && (e.key === "Enter" || e.keyCode === 13)) {
            e.preventDefault();
            onSend();
        }
    } catch {}
}

function autoResize() {
    try {
        const textarea = textInput.value;
        if (!textarea) return;
        
        // Reset height to auto to get the correct scrollHeight
        textarea.style.height = 'auto';
        
        // Calculate new height based on content
        const newHeight = Math.min(textarea.scrollHeight, 120); // Max 3x height (120px)
        textarea.style.height = newHeight + 'px';
    } catch {}
}

function handleQuickResponsesWheel(e: WheelEvent) {
    const scroller = e.currentTarget as HTMLElement;
    if (scroller) {
        // Prevent the default scroll behavior to avoid vertical scrolling
        e.preventDefault();
        
        // Scroll horizontally based on wheel delta
        scroller.scrollLeft += e.deltaY;
    }
}
</script>

<style scoped>
.chat-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    min-width: 0;
    width: 100%;
    max-width: 100%;
    /* Ensure the chat view properly handles flex children */
    flex: 1;
    box-sizing: border-box;
    overflow-x: hidden;
    contain: inline-size;
    isolation: isolate;
}

.quick-responses-container {
    flex-shrink: 0;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
    position: relative;
    overflow: hidden; /* isolate child scroll width */
    contain: inline-size; /* prevent children from affecting container width */
    background: transparent; /* no bar background */
    border: 0;
}

.quick-responses-scroller {
    display: block;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: thin;
    scrollbar-gutter: stable both-edges;
    contain: content; /* keep child layout from impacting ancestors */
    background: transparent; /* no bar background */
    border: 0;
    padding: 0 16px 4px;
}

.quick-responses-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
    cursor: pointer;
    background: var(--ui-surface);
    border: 1px solid var(--ui-border);
    width: 34px;
    height: 34px;
    margin-right: 2px;
    border-radius: var(--ui-radius-sm);
    transition: background-color 0.15s ease;
}

.quick-responses-toggle:hover {
    background-color: var(--ui-primary-surface);
    border-color: var(--ui-primary-border);
}

.quick-responses-toggle ion-icon {
    font-size: 18px;
    color: var(--ion-color-medium);
    transition: transform 0.2s ease;
}

.quick-responses {
    display: inline-flex;
    flex-wrap: nowrap;
    gap: 8px;
    padding: 5px 0;
    margin: 0;
    box-sizing: border-box;
    white-space: nowrap;
    max-width: 100%;   /* do not inform parent of wider intrinsic size */
}

.quick-response-card {
    background-color: var(--ui-surface-raised);
    color: var(--ui-text);
    padding: 9px 12px;
    border-radius: var(--ui-radius-sm);
    cursor: pointer;
    font-size: 14px;
    box-shadow: var(--ui-shadow-soft);
    transition: transform 0.15s ease, background-color 0.15s ease;
    white-space: nowrap;
    flex: 0 0 auto;
    /* Allow card to grow to fit content naturally */
    box-sizing: border-box;
    border: 1px solid var(--ui-border);
}

.quick-response-card:hover {
    background-color: var(--ui-primary-surface);
    border-color: var(--ui-primary-border);
    transform: scale(1.02);
    box-shadow: var(--ui-shadow-soft);
}

.quick-response-card:active {
    transform: scale(0.97);
}

/* Dark mode overrides for quick responses */
.ion-palette-dark .quick-response-card {
    background-color: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.15);
}

.ion-palette-dark .quick-response-card:hover {
    background-color: rgba(255, 255, 255, 0.15);
}

/* Ensure the composer area is properly spaced */
.composer {
    margin-top: 8px;
    /* Ensure composer doesn't get affected by quick responses overflow */
    flex-shrink: 0;
    min-width: 0;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow: hidden; /* clip any horizontal overflow entirely */
    contain: inline-size; /* prevent children intrinsic width from expanding container */
}

/* Ensure proper alignment of elements in composer */
.composer ::v-deep ion-item {
    width: 100% !important;
    align-items: center;
}

/* Make the textarea behave as a flexible/shrinkable element so it doesn't push out other controls */
.composer .message-input {
    flex: 1 1 auto !important;
    min-width: 0 !important;
    resize: none;
    overflow-y: auto;
    min-height: 38px;
    max-height: 120px; /* 3x the min-height */
    line-height: 1.4;
    padding: 9px 12px;
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius-sm);
    background: var(--ui-surface);
    color: var(--ui-text);
    font-family: inherit;
    font-size: 16px;
    outline: none;
    transition: border-color 0.2s ease;
}

.composer .message-input:focus {
    border-color: var(--ion-color-primary);
    box-shadow: 0 0 0 3px var(--ui-focus-ring);
}

.composer :deep(ion-button[slot="end"]) {
    --background: var(--ion-color-primary);
    --background-hover: var(--ion-color-primary-shade);
    --border-radius: var(--ui-radius-sm);
    --box-shadow: none;
    --color: var(--ion-color-primary-contrast);
    min-height: 38px;
    margin: 0 2px 0 6px;
    font-weight: 750;
}

/* Ensure the send/upload buttons do not grow */
.composer ::v-deep ion-button[slot="end"],
.composer ::v-deep .upload-btn,
.composer ::v-deep .quick-responses-toggle {
    flex: 0 0 auto !important;
}

.header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--ion-color-light-tint);
}

.filter-bar {
    flex-shrink: 0;
    display: flex;
    gap: 8px;
    margin: 12px 16px 0;
    padding: 12px;
    background: var(--ui-surface-raised);
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius-lg);
    box-shadow: var(--ui-shadow-soft);
}

.filter-field {
    display: flex;
    min-width: 0;
    flex: 1 1 0;
    flex-direction: column;
    gap: 5px;
}

.filter-label {
    color: var(--ui-text-muted);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
}

.filter-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    min-height: 36px;
    width: 100%;
    padding: 0 8px 0 9px;
    background: var(--ui-surface);
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius-sm);
    color: var(--ui-text);
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
}

.filter-trigger-summary {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.filter-trigger:hover,
.filter-trigger:focus-visible {
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

/* Aggressive overrides for Ionic item/label host and shadow parts to reduce default min-height.
   We target both the ::part(native) element (the internal native wrapper) and the ion-item host
   to ensure the 48px min-height applied by Ionic is overridden within the composer. */
.composer ::v-deep ion-item {
    /* Try both the CSS variable and direct min-height override for maximum compatibility */
    --min-height: 32px !important;
    min-height: 32px !important;
    height: auto !important;
}

.composer ::v-deep ion-item::part(native) {
    min-height: 32px !important;
    height: auto !important;
    padding-top: 5px !important;
    padding-bottom: 5px !important;
    align-items: center !important;
    display: flex !important;
}

/* inner wrapper part (if present) */
.composer ::v-deep ion-item::part(inner) {
    padding-top: 4px !important;
    padding-bottom: 4px !important;
}

/* label native part adjustments */
.composer ::v-deep ion-label::part(native) {
    line-height: 1.1 !important;
    padding-top: 0 !important;
    padding-bottom: 0 !important;
    margin: 0 !important;
    font-size: 14px;
}

/* Fallback: target the host element too in case styling is applied on :host */
.composer ::v-deep ion-item {
    display: flex !important;
    align-items: center !important;
}

.messages {
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
    overflow: auto;
    padding: 18px 20px 22px;
    scroll-behavior: smooth;
    /* Clean background - no image */
    background-color: var(--ion-background-color);
    display: flex;
    flex-direction: column;
    gap: 10px;
    box-sizing: border-box;
}

/* message bubbles - theme-aware colors */
.message {
    /* Telegram-like lightly filled bubble */
    padding: 12px 14px;
    border-radius: var(--ui-radius-lg);
    max-width: 80%;
    word-break: break-word;
    display: flex;
    flex-direction: column;
    gap: 9px;
    background: var(--ui-surface-raised);
    border: 1px solid var(--ui-border);
    color: var(--ion-text-color);

    min-width: 0;

    /* Subtle appear animation */
    animation: messageIn 0.2s ease-out backwards;
}

@keyframes messageIn {
    from {
        opacity: 0;
        transform: translateY(8px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

/* Bot messages with configurable transparency */
.message[data-type="bot_message"],
.message[data-type="bot_message_service"] {
    opacity: var(--bot-message-opacity, 1);
}

/* left / right positioning - theme-aware colors */
.message.left {
    align-self: flex-start;
    /* incoming messages: subtle background */
    background: var(--ui-surface-raised);
    border: 1px solid var(--ui-border);
    color: var(--ion-text-color);
}

.message.right {
    align-self: flex-end;
    /* outgoing messages: primary tint */
    background: var(--ui-primary-surface);
    border: 1px solid var(--ui-primary-border);
    color: var(--ui-text);
}

/* Dark mode overrides for message bubbles */
.ion-palette-dark .message.left {
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.15);
}

.ion-palette-dark .message.right {
    background: var(--ion-color-primary);
    border: 1px solid var(--ion-color-primary-shade);
}

/* Events are timeline activity, never a directional sender/recipient bubble. */
.message.center,
.message.event-message {
    align-self: stretch;
    width: 100%;
    max-width: none;
    box-sizing: border-box;
    padding: 11px 14px;
    background: var(--ui-event-surface);
    border: 1px solid var(--ui-event-border);
    border-left: 4px solid var(--ui-event-accent);
    border-radius: var(--ui-radius-md);
    color: var(--ui-text-muted);
    text-align: center;
}

.event-heading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--ui-event-accent);
}

.event-marker {
    display: inline-flex;
    width: 22px;
    height: 22px;
    align-items: center;
    justify-content: center;
    color: var(--ui-event-marker-text);
    background: var(--ui-event-accent);
    border-radius: 7px;
    font-size: 12px;
    font-style: normal;
}

.event-label {
    font-size: 11px;
    font-weight: 850;
    letter-spacing: 0.1em;
    text-transform: uppercase;
}

.event-rule {
    width: 42px;
    height: 1px;
    background: var(--ui-event-border);
}

.event-message .body {
    align-items: center;
    color: var(--ui-text);
}

.event-message .message-text {
    font-weight: 650;
}

.event-message .message-tags,
.event-message .attachments {
    justify-content: center;
}

.ion-palette-dark .message.center {
    background: var(--ui-event-surface);
    border-color: var(--ui-event-border);
}

/* special styling for bot-side 'service_call' messages:
   - make them longer/wider and give a prominent red 2px border */
.message.left[data-type="service_call"] {
    max-width: 95%;
    /* ensure a noticeably longer appearance on wide screens */
    border: 2px solid var(--ion-color-danger);
    border-radius: 12px;
    padding: 12px 14px;

    min-width: 0;
}

/* special styling for 'error_message' messages:
   - reddish dimmed background to indicate error */
.message[data-type="error_message"] {
    background: rgba(var(--ion-color-danger-rgb), 0.15);
    border: 1px solid rgba(var(--ion-color-danger-rgb), 0.3);
    color: inherit;
}

/* small annotation on top (message type label) */
.message .annotation {
    font-size: 11px;
    color: #374151;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    font-weight: 700;
}

.ion-palette-dark .message .annotation {
    color: #d1d5db;
}

.message.left .annotation {
    color: #1f2937;
}

.ion-palette-dark .message.left .annotation {
    color: #f3f4f6;
}

.message.right .annotation {
    color: #ffffff;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

/* meta (username) */
.message .meta {
    display: flex;
    justify-content: flex-start;
    align-items: center;
    margin-bottom: 2px;
    font-size: 13px;
    color: #374151;
    font-weight: 700;
}

.ion-palette-dark .message .meta {
    color: #d1d5db;
}

.message.left .meta {
    color: #1f2937;
}

.ion-palette-dark .message.left .meta {
    color: #f3f4f6;
}

.message.right .meta {
    color: #ffffff;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

.auto-message {
    opacity: 0.5;
}

/* body */
.body {
    display: flex;
    flex-direction: column;
    white-space: pre-wrap;
    font-size: 16px;
}

/* tag chips on messages */
.message-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 7px;
}

.tag-chip {
    display: inline-block;
    padding: 4px 8px;
    color: var(--ui-tag-text);
    background: var(--ui-tag-surface);
    border: 1px solid var(--ui-tag-border);
    border-radius: 999px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.01em;
    white-space: nowrap;
}

.ion-palette-dark .tag-chip {
    color: var(--ui-tag-text);
    background: var(--ui-tag-surface);
    border-color: var(--ui-tag-border);
}

/* time indicator placed after text, dimmed and small */
.message .time-indicator {
    font-size: 12px;
    color: var(--ui-text-muted);
    font-weight: 650;
    align-self: flex-end;
    margin-top: 2px;
    padding-top: 4px;
    border-top: 1px solid var(--ui-border);
    width: 100%;
    text-align: right;
}

.ion-palette-dark .message .time-indicator {
    color: #d1d5db;
}

.message.left .time-indicator {
    color: #1f2937;
}

.ion-palette-dark .message.left .time-indicator {
    color: #f3f4f6;
}

.message.right .time-indicator {
    color: #ffffff;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

.event-message .time-indicator {
    align-self: center;
    width: auto;
    min-width: 120px;
    color: var(--ui-text-muted);
    border-top-color: var(--ui-event-border);
    text-align: center;
}

.ion-palette-dark .message .time-indicator {
    border-top-color: rgba(255, 255, 255, 0.08);
}

/* system messages */
.message[data-type="system"] {
    background: var(--ion-color-light-shade);
    font-style: italic;
    align-self: center;
    color: var(--ion-color-medium);
}

.ion-palette-dark .message[data-type="system"] {
    background: rgba(255, 255, 255, 0.08);
}

/* composer */
.composer {
    margin-top: 10px;
    padding: 12px 16px 16px;
    background: var(--ui-surface);
    border-top: 1px solid var(--ui-border);
}

.composer > ion-item {
    --background: var(--ui-surface-raised);
    --inner-border-width: 0;
    --min-height: 54px;
    --padding-start: 6px;
    --padding-end: 6px;
    border: 1px solid var(--ui-border-strong);
    border-radius: var(--ui-radius-lg);
    box-shadow: var(--ui-shadow-soft);
}

.composer > ion-item::part(native) {
    min-height: 54px;
    padding: 8px 6px;
}

/* upload button small left margin (visual tweak) */
.upload-btn {
    width: 34px;
    height: 34px;
    background: var(--ui-surface);
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius-sm);
    color: var(--ui-text-muted);
    font-size: 21px;
    cursor: pointer;
    margin-left: 6px;
    margin-right: 8px;
    line-height: 1;
}

/* attachments inside messages */
.attachments {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 6px;
}

/* individual attachment layout */
.attachment {
    display: flex;
    gap: 8px;
    align-items: flex-start;
}

/* Stack preview (image/video) and filename vertically to avoid long filenames forcing width */
.attachment.has-preview {
    flex-direction: column;
    align-items: flex-start;
}

/* Place filename/meta under previews and allow wrapping/truncation */
.attachment.has-preview .attachment-meta {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-start;
    width: 100%;
}

/* when there are previews (image/video/document preview) and text below,
   add a subtle separator similar to Telegram between media and message text */
.message .attachments + .message-text {
    border-top: 1px solid rgba(0, 0, 0, 0.06);
    padding-top: 8px;
    margin-top: 8px;
}

/* ensure download filename truncates if long */
.attachment-download {
    color: var(--ion-color-primary);
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.attachment-download .download-icon {
    font-size: 12px;
    opacity: 0.85;
    margin-left: 4px;
}

/* pending files list tweaks */
.pending {
    display: flex;
    align-items: center;
    gap: 8px;
}
.pending .name {
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: inline-block;
}
/* small left margin for delete/remove button (visual spacing) */
.pending .remove {
    margin-left: 8px;
}

/* preview images/videos */
.attachment-preview.image,
.attachment-preview.video {
    max-height: 200px;
    max-width: 100%;
    width: auto;
    border-radius: 6px;
}

/* document icon fallback */
.attachment-doc {
    font-size: 28px;
    width: 48px;
    height: 48px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.03);
}

/* meta (filename + size) */
.attachment-meta {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
}

.attachment-download {
    color: var(--ion-color-primary);
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
}
.attachment-download .download-icon {
    font-size: 12px;
    opacity: 0.85;
    margin-left: 4px;
}

.attachment-size {
    color: var(--ion-color-medium);
    font-size: 13px;
}

.attachment-error {
    color: #e74c3c;
    font-size: 13px;
}

.upload-btn:hover,
.upload-btn:focus-visible {
    color: var(--ion-color-primary);
    border-color: var(--ui-primary-border);
    outline: none;
}

/* dangerous file warning chip */
.dangerous-file-warning {
    margin-bottom: 4px;
    font-size: 12px;
    --background: rgba(255, 193, 7, 0.2);
    --color: #856404;
}

.ion-palette-dark .dangerous-file-warning {
    --background: rgba(255, 193, 7, 0.15);
    --color: #ffc107;
}

/* minor tweak for message text after files */
.message-text {
    /* margin-top: 4px; */
}

/* highlight styling for search matches */
:deep(.hl) {
    background: var(--ion-color-warning-tint);
    color: var(--ion-color-warning-contrast);
    border-radius: 3px;
    padding: 0 2px;
}

/* top loader indicator during pagination fetch */
.loading-top {
    text-align: center;
    font-size: 12px;
    color: var(--ion-color-medium);
    padding: 8px 0;
    display: flex;
    justify-content: center;
}

/* Message loading skeleton */
.message-skeleton {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 4px 0;
}

.msg-skel-bubble {
    max-width: 80%;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    border-radius: 16px;
    background: var(--ion-color-light);
}

.msg-skel-left {
    align-self: flex-start;
}

.msg-skel-right {
    align-self: flex-end;
}

.msg-skel-line {
    height: 10px;
    border-radius: 5px;
    background: var(--ion-color-light-shade);
    animation: msgSkelPulse 1.5s ease-in-out infinite;
}

.msg-skel-line-1 {
    width: 70%;
}

.msg-skel-line-2 {
    width: 45%;
}

@keyframes msgSkelPulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
}

.ion-palette-dark .msg-skel-bubble {
    background: rgba(255, 255, 255, 0.06);
}

.ion-palette-dark .msg-skel-line {
    background: rgba(255, 255, 255, 0.1);
}

/* Error banner for failed message loads */
.messages-error {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    margin-bottom: 8px;
    background: rgba(var(--ion-color-danger-rgb), 0.1);
    border: 1px solid rgba(var(--ion-color-danger-rgb), 0.3);
    border-radius: 8px;
    font-size: 13px;
    color: var(--ion-color-danger);
    flex-shrink: 0;
}

.error-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.error-retry {
    background: var(--ion-color-danger);
    color: white;
    border: none;
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
}

.error-retry:hover {
    opacity: 0.85;
}

.error-dismiss {
    background: transparent;
    border: none;
    color: var(--ion-color-danger);
    font-size: 14px;
    cursor: pointer;
    padding: 2px 4px;
    flex-shrink: 0;
}

/* Enhanced empty state */
.empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px;
    color: var(--ion-color-medium);
    text-align: center;
}

.empty-icon {
    font-size: 48px;
    margin-bottom: 12px;
    opacity: 0.6;
}

.empty-msg {
    font-size: 16px;
    font-weight: 600;
    color: var(--ion-text-color);
    margin-bottom: 6px;
}

.empty-sub {
    font-size: 13px;
    color: var(--ion-color-medium);
    max-width: 260px;
}

@media (max-width: 640px) {
    .filter-bar {
        margin: 10px 10px 0;
        padding: 10px;
        flex-wrap: wrap;
    }

    .filter-field {
        min-width: 140px;
    }

    .messages {
        padding: 14px 10px 18px;
    }

    .message {
        max-width: 92%;
    }

    .message.center,
    .message.event-message {
        width: 100%;
        max-width: 100%;
    }

    .composer {
        padding: 10px;
    }

    .composer > ion-item::part(native) {
        padding: 7px 5px;
    }
}
</style>
