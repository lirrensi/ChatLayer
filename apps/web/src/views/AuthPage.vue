<!--
FILE: apps/web/src/views/AuthPage.vue
PURPOSE: Standalone full-page API key entry; validates key and redirects to intended route or /home.
OWNS: Auth page rendering, key submission, URL-key fallback detection on mount
EXPORTS: default (SFC)
DOCS: .agents/reports/plan_auth-separate-page_2026-07-30.md
-->
<template>
    <ion-page>
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
                        <ion-spinner v-if="loading" slot="start" />
                        <span v-if="!loading">{{ $t("auth.submit") }}</span>
                    </ion-button>
                </div>
            </div>
            <ion-toast
                :is-open="toastVisible"
                :message="toastMessage"
                duration="3000"
                @didDismiss="toastVisible = false"
            />
        </ion-content>
    </ion-page>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
    IonPage,
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
const router = useRouter();

const apiKey = ref("");
const loading = ref(false);
const toastVisible = ref(false);
const toastMessage = ref("");

// Belt-and-suspenders: check URL for ?api_key= / ?apiKey= on mount.
// The router guard is the primary path, but this catches direct /auth?api_key= navigations.
// Also handles ?reason= query param from guard redirects (invalid URL key, session expiry).
onMounted(async () => {
    const route = router.currentRoute.value;

    // Show toast for guard-passed reason (e.g., invalid URL key)
    const reason = route.query.reason as string;
    if (reason) {
        if (reason === 'invalid_url_key') {
            toastMessage.value = t("auth.invalid_key");
            toastVisible.value = true;
        }
        // Clean the reason param so it doesn't survive a refresh
        router.replace({ query: {} });
        return;
    }

    const urlKey = (route.query.api_key as string) || (route.query.apiKey as string);
    if (!urlKey) return;

    apiKey.value = urlKey;
    loading.value = true;
    setApiKey(urlKey);

    const result = await validateApiKey();
    if (result.ok) {
        // Valid key — redirect to intended route or home without rendering form
        const intended = sessionStorage.getItem("intendedRoute");
        sessionStorage.removeItem("intendedRoute");
        router.replace(intended || "/home");
    } else {
        // Invalid key — clear, show toast, stay on page
        clearApiKey();
        toastMessage.value = result.error || t("auth.invalid_key");
        toastVisible.value = true;
        // Clean URL params so a refresh won't re-detect the bad key
        router.replace({ query: {} });
    }

    loading.value = false;
});

async function submit() {
    if (!apiKey.value) return;
    loading.value = true;
    setApiKey(apiKey.value);

    const result = await validateApiKey();
    if (result.ok) {
        const intended = sessionStorage.getItem("intendedRoute");
        sessionStorage.removeItem("intendedRoute");
        router.replace(intended || "/home");
    } else {
        clearApiKey();
        toastMessage.value = result.error || t("auth.invalid_key");
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
</style>
