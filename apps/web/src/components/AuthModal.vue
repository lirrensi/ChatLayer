<template>
    <ion-modal
        :is-open="visible"
        backdrop-dismiss="false"
    >
        <ion-header>
            <ion-toolbar>
                <ion-title>{{ $t("modal.auth.title") }}</ion-title>
            </ion-toolbar>
        </ion-header>

        <ion-content class="ion-padding">
            <div class="center">
                <p>{{ $t("modal.auth.instructions") }}</p>
                <ion-item>
                    <ion-label position="stacked">{{ $t("auth.api_key_label") }}</ion-label>
                    <ion-input
                        v-model="apiKey"
                        :placeholder="$t('auth.placeholder')"
                        autocapitalize="off"
                        autocomplete="off"
                        :disabled="loading"
                        @keyup.enter="submit"
                    />
                </ion-item>

                <div class="actions">
                    <ion-button
                        expand="block"
                        :disabled="!apiKey || loading"
                        @click="submit"
                    >
                        <ion-spinner
                            v-if="loading"
                            slot="start"
                        />
                        <span v-if="!loading">{{ $t("auth.submit") }}</span>
                    </ion-button>
                </div>

                <p class="hint">
                    {{ $t("auth.stored_notice_prefix") }} <code>Authorization: Bearer token</code> header.
                </p>
            </div>

            <ion-toast
                :is-open="toastVisible"
                :message="toastMessage"
                duration="3000"
            />
        </ion-content>
    </ion-modal>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import {
    IonModal,
    IonContent,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonItem,
    IonLabel,
    IonInput,
    IonButton,
    IonSpinner,
    IonToast,
} from "@ionic/vue";
import { setApiKey, clearApiKey, validateApiKey } from "../services/api";
import { useI18n } from "vue-i18n";
const { t } = useI18n();

const emit = defineEmits(["authenticated"]);

const visible = ref(true);
const apiKey = ref("");
const loading = ref(false);
const toastVisible = ref(false);
const toastMessage = ref("");

// Try to pick up ?api_key=... or ?apiKey=... from URL on mount and validate immediately.
onMounted(async () => {
    try {
        const params = new URLSearchParams(window.location.search);
        const keyFromUrl = params.get("api_key") || params.get("apiKey");
        if (!keyFromUrl) return;

        apiKey.value = keyFromUrl;
        loading.value = true;
        // Tentatively set key so axios interceptor will send it when validating
        setApiKey(apiKey.value);
        const res = await validateApiKey();
        if (res.ok) {
            // accepted: close modal and emit authenticated
            visible.value = false;
            // remove key from URL to avoid leaking it in history
            params.delete("api_key");
            params.delete("apiKey");
            const qs = params.toString();
            const newUrl = window.location.pathname + (qs ? `?${qs}` : "");
            window.history.replaceState(null, "", newUrl);
            emit("authenticated");
        } else {
            // invalid: clear stored key and show toast
            clearApiKey();
            toastMessage.value = res.error || t("auth.invalid_key");
            toastVisible.value = true;
        }
    } catch (e: any) {
        console.error("api key from URL validation error", e);
        toastMessage.value = e?.message || t("auth.invalid_key");
        toastVisible.value = true;
    } finally {
        loading.value = false;
    }
});

async function submit() {
    if (!apiKey.value) return;
    loading.value = true;
    // Tentatively set key so axios interceptor will send it when validating
    setApiKey(apiKey.value);
    const res = await validateApiKey();
    if (res.ok) {
        visible.value = false;
        emit("authenticated");
    } else {
        clearApiKey();
        toastMessage.value = res.error || t("auth.invalid_key");
        toastVisible.value = true;
    }
    loading.value = false;
}
</script>

<style scoped>
.center {
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-width: 480px;
    margin: 24px auto;
}
.actions {
    margin-top: 8px;
}
.hint {
    color: var(--ion-color-medium);
    font-size: 13px;
}
</style>
