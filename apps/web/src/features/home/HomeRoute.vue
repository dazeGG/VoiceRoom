<script setup lang="ts">
// What `/` shows, and every route the lobby keeps in the address (the admin
// panel's tabs): the lobby or the landing on a desktop, a room start on a phone.
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { applyDesktopBoundaryToDocument } from '@/platform/desktop-boundary';
import { ToastStack } from '@/shared/ui';
import HomePage from './HomePage.vue';
import MobileStartScreen from './components/MobileStartScreen.vue';
import { useToastsStore } from './model/toasts.store';

const toasts = useToastsStore();

const boundaryReady = ref(false);
const desktopAllowed = ref(false);
// A phone cannot run the lobby, but it can run a room, so `/` offers to start
// one instead of turning the visitor away.
const roomClientAllowed = ref(false);

// Svelte: <svelte:head>. The route sets the tab title and the browser colour while it is shown.
const previousTitle = document.title;
const themeColor = document.createElement('meta');
themeColor.name = 'theme-color';
themeColor.content = '#131416';

onMounted(() => {
  document.title = 'VoiceRoom';
  document.head.append(themeColor);
  const policy = applyDesktopBoundaryToDocument();
  desktopAllowed.value = policy.desktopAllowed;
  roomClientAllowed.value = policy.roomClientAllowed;
  boundaryReady.value = true;
});

onBeforeUnmount(() => {
  document.title = previousTitle;
  themeColor.remove();
});
</script>

<template>
  <div v-if="!boundaryReady" class="app-shell">
    <main class="auth-loader" aria-label="Проверка устройства" aria-busy="true">
      <div class="auth-loader__card">
        <p class="auth-loader__kicker">Проверяем устройство</p>
        <h1 class="auth-loader__title">VoiceRoom запускается</h1>
      </div>
    </main>
  </div>
  <HomePage v-else-if="desktopAllowed" />
  <template v-else-if="roomClientAllowed">
    <MobileStartScreen @toast="toasts.pushToast" />
    <ToastStack :toasts="toasts.items" :on-dismiss="toasts.dismissToast" />
  </template>
  <div v-else class="app-shell">
    <main class="auth-session-error" aria-label="Неподдерживаемое устройство" aria-live="polite">
      <div class="auth-session-error__card">
        <p class="auth-session-error__kicker">Desktop only</p>
        <h1 class="auth-session-error__title">Откройте VoiceRoom на компьютере</h1>
        <p class="auth-session-error__text">
          Мобильные браузеры не запускают этот клиент: realtime, голос, медиа и push-уведомления здесь отключены.
        </p>
      </div>
    </main>
  </div>
</template>
