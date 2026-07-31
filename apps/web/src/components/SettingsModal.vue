<!--
FILE: apps/web/src/components/SettingsModal.vue
PURPOSE: Edit manager appearance and notification preferences in a modal dialog.
OWNS: Settings controls, local form state, and dismiss events.
EXPORTS: SettingsModal — manager preferences surface.
DOCS: docs/core/web-ui.md
-->
<template>
    <IonModal :isOpen="isOpen" @didDismiss="onDismiss" :keepContentsMounted="true">
        <IonHeader>
            <IonToolbar>
                <IonTitle>{{ $t("settings.title") }}</IonTitle>
                <IonButtons slot="end">
                    <IonButton @click="closeModal">
                        <IonIcon :icon="closeOutline" />
                    </IonButton>
                </IonButtons>
            </IonToolbar>
        </IonHeader>
        
        <IonContent class="ion-padding">
            <!-- Notification Level -->
            <IonItem>
                <IonLabel>{{ $t("settings.notification_level") }}</IonLabel>
                <IonSelect
                    :value="localSettings.notificationLevel"
                    @ionChange="onNotificationLevelChange"
                    interface="popover"
                >
                    <IonSelectOption value="All">{{ $t("settings.notification_all") }}</IonSelectOption>
                    <IonSelectOption value="ManagerCalls">{{ $t("settings.notification_manager_calls") }}</IonSelectOption>
                    <IonSelectOption value="None">{{ $t("settings.notification_none") }}</IonSelectOption>
                </IonSelect>
            </IonItem>

            <!-- Theme Selection -->
            <IonItem>
                <IonLabel>{{ $t("settings.theme") }}</IonLabel>
                <IonSelect
                    :value="localSettings.theme"
                    @ionChange="onThemeChange"
                    interface="popover"
                >
                    <IonSelectOption value="light">{{ $t("settings.theme_light") }}</IonSelectOption>
                    <IonSelectOption value="dark">{{ $t("settings.theme_dark") }}</IonSelectOption>
                    <IonSelectOption value="system">{{ $t("settings.theme_system") }}</IonSelectOption>
                </IonSelect>
            </IonItem>

            <!-- Bot Message Transparency Slider -->
            <IonItem lines="none">
                <IonLabel>
                    {{ $t("settings.bot_transparency") }}
                    <p class="slider-value">{{ localSettings.botMessageOpacity }}%</p>
                </IonLabel>
            </IonItem>
            <IonItem class="slider-item">
                <IonRange
                    :value="localSettings.botMessageOpacity"
                    @ionChange="onBotTransparencyChange"
                    :min="50"
                    :max="100"
                    :step="5"
                    :pin="true"
                    :ticks="true"
                >
                    <IonLabel slot="start">50%</IonLabel>
                    <IonLabel slot="end">100%</IonLabel>
                </IonRange>
            </IonItem>

            <!-- Font Size Slider -->
            <IonItem lines="none">
                <IonLabel>
                    {{ $t("settings.font_size") }}
                    <p class="slider-value">{{ localSettings.fontSize }}px</p>
                </IonLabel>
            </IonItem>
            <IonItem class="slider-item">
                <IonRange
                    :value="localSettings.fontSize"
                    @ionChange="onFontSizeChange"
                    :min="14"
                    :max="24"
                    :step="1"
                    :pin="true"
                    :ticks="true"
                >
                    <IonLabel slot="start">14px</IonLabel>
                    <IonLabel slot="end">24px</IonLabel>
                </IonRange>
            </IonItem>
        </IonContent>
    </IonModal>
</template>

<script setup lang="ts">
import { IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon, IonContent, IonItem, IonLabel, IonSelect, IonSelectOption, IonRange } from "@ionic/vue";
import { closeOutline } from "ionicons/icons";
import { onMounted } from "vue";
import { useUiStore } from "../stores/uiStore";
import { storeToRefs } from "pinia";

const props = defineProps({
    isOpen: {
        type: Boolean,
        default: false
    }
});

const emit = defineEmits(['dismiss']);

const ui = useUiStore();
const { localSettings } = storeToRefs(ui);

function closeModal() {
    emit('dismiss');
}

function onDismiss() {
    emit('dismiss');
}

function onNotificationLevelChange(event: any) {
    const value = event.detail.value;
    if (value) {
        ui.localSettings.notificationLevel = value;
    }
}

function onThemeChange(event: any) {
    const value = event.detail.value;
    if (value) {
        ui.localSettings.theme = value;
        ui.applyThemeSettings();
    }
}

function onBotTransparencyChange(event: any) {
    const value = event.detail.value;
    if (typeof value === "number") {
        ui.localSettings.botMessageOpacity = value;
        ui.applyThemeSettings();
    }
}

function onFontSizeChange(event: any) {
    const value = event.detail.value;
    if (typeof value === "number") {
        ui.localSettings.fontSize = value;
        ui.applyThemeSettings();
    }
}

// Apply theme settings when modal opens
onMounted(() => {
    ui.applyThemeSettings();
});
</script>

<style scoped>
/* Use Ionic defaults to avoid clipping content inside modal */
.slider-item {
    --padding-start: 16px;
    --padding-end: 16px;
    --inner-padding-end: 16px;
}

.slider-value {
    margin: 4px 0 0 0;
    font-size: 14px;
    color: var(--ion-color-medium);
}
</style>
