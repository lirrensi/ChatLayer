<template>
    <ion-app>
        <ion-router-outlet />
    </ion-app>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { IonApp, IonRouterOutlet } from "@ionic/vue";

const router = useRouter();

function onAuthRequired() {
    // When api layer detects 401/403 it will clear the key and dispatch "authRequired".
    // Redirect to /auth so user can re-authenticate.
    router.push('/auth');
}
 
onMounted(() => {
    window.addEventListener("authRequired", onAuthRequired);
});
 
onUnmounted(() => {
    window.removeEventListener("authRequired", onAuthRequired);
});
</script>

<style>
/* Global scrollbar styling */
::-webkit-scrollbar {
    width: 6px;
    height: 6px;
}
::-webkit-scrollbar-thumb {
    background: var(--ion-color-medium);
    border-radius: 3px;
}
::-webkit-scrollbar-track {
    background: transparent;
}

/* Dark mode scrollbar */
.ion-palette-dark ::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.25);
}
.ion-palette-dark ::-webkit-scrollbar-track {
    background: transparent;
}
</style>
