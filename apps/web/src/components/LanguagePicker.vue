<template>
    <div class="locale-actions">
        <ion-select
            :value="locale"
            @ionChange="onChange"
            interface="popover"
            aria-label="Language"
        >
            <ion-select-option
                v-for="loc in availableLocales"
                :key="loc.code"
                :value="loc.code"
            >
                {{ loc.langNativeName }}
            </ion-select-option>
        </ion-select>

        <!-- logout button placed to the right of the selector -->
        <ion-button
            size="small"
            fill="clear"
            @click="logout"
            :aria-label="t('ui.logout')"
        >
            {{ t('ui.logout') }}
        </ion-button>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { IonSelect, IonSelectOption, IonButton } from "@ionic/vue";
import {
    i18n,
    setLocale,
    getAvailableLocales,
    type SupportedLocale,
    type LocaleMetadata,
} from "../i18n";
import { clearApiKey } from "../services/api";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
const locale = ref<SupportedLocale>("en");

// Dynamically get all available locales from i18n configuration
// This will automatically include any new JSON files added to src/locales/
const availableLocales = computed<LocaleMetadata[]>(() => {
    return getAvailableLocales();
});

onMounted(() => {
    // read current runtime locale
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const g: any = i18n.global;
        if (g && typeof g.locale === "object" && "value" in g.locale) {
            locale.value = g.locale.value || "en";
        } else {
            locale.value = g.locale || "en";
        }
    } catch {
        locale.value = "en";
    }
});

function onChange(ev: any) {
    const v = ev?.detail?.value;
    if (!v) return;
    setLocale(v as SupportedLocale);
    locale.value = v as SupportedLocale;
}

function logout() {
    try {
        clearApiKey();
    } catch {}
    // full page refresh to reset app state
    try {
        location.reload();
    } catch {
        // fallback
        window.location.href = window.location.href;
    }
}
</script>

<style scoped>
.locale-actions {
    display: flex;
    align-items: center;
    gap: 8px;
}

/* small select sizing so it fits in toolbar */
ion-select {
    --min-width: 44px;
    --padding-start: 6px;
    --padding-end: 6px;
    height: 36px;
}

/* ensure the logout button shows its text (not icon-only) and doesn't get clipped */
.locale-actions ion-button {
    --padding-start: 8px;
    --padding-end: 8px;
    height: 36px;
    min-width: auto !important;
    padding: 0 8px !important;
    white-space: nowrap;
    overflow: visible;
    text-overflow: ellipsis;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    text-transform: none !important;
    font-size: 14px;
}

/* target Ionic internal native part to avoid icon-only compact rendering */
.locale-actions ::v-deep ion-button::part(native) {
    min-width: auto !important;
    padding: 0 8px !important;
}

/* small visual tweak to keep buttons compact but readable */
.locale-actions ion-button::part(icon) {
    margin-left: 6px;
}

/* keep select compact */
ion-select {
    --min-width: 44px;
    --padding-start: 6px;
    --padding-end: 6px;
    height: 36px;
}
</style>
