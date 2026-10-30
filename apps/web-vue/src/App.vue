<script setup lang="ts">
// What apps/web's routes/+layout.svelte did around every page: the device
// boundary, the deploy check and its update notice, the call feedback question,
// and the app-wide listeners (theme, desktop system, emoji copy).
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterView, useRoute, useRouter } from 'vue-router';
import { loadAccountBadges } from '@/api/badges';
import { onContractViolation } from '@/api/contract-violations';
import { useAppUpdateStore } from '@/features/app-update/app-update.store';
import AppUpdateNotice from '@/features/app-update/AppUpdateNotice.vue';
import { reloadNavigationsOnUpdate } from '@/features/app-update/update-navigation';
import { createVersionCheck } from '@/features/app-update/version-check';
import { useCallFeedbackStore } from '@/features/call-feedback/call-feedback.store';
import CallFeedbackPrompt from '@/features/call-feedback/CallFeedbackPrompt.vue';
import { useLeaveScreenStore } from '@/features/room/leave-screen.store';
import { applyDesktopBoundaryToDocument } from '@/platform/desktop-boundary';
import { bindDesktopSystem } from '@/platform/desktop-system';
import { isMobileRoute } from '@/platform/mobile-routes';
import { useCallActivityStore } from '@/shared/call-activity.store';
import { installEmojiCopy } from '@/shared/chat/emoji-copy';
import { useThemeStore } from '@/shared/theme/theme.store';

const route = useRoute();
const router = useRouter();
const appUpdate = useAppUpdateStore();
const callActivity = useCallActivityStore();
const callFeedback = useCallFeedbackStore();
const leaveScreen = useLeaveScreenStore();
const theme = useThemeStore();

const boundaryReady = ref(false);
const desktopAllowed = ref(false);
const roomClientAllowed = ref(false);
// Phones get only the routes in mobile-routes.ts; the rest keep the block
// screen below.
const allowed = computed(() => desktopAllowed.value || (roomClientAllowed.value && isMobileRoute(route.meta.routeId)));

// A new deploy (the version check) or a downloaded desktop shell.
const versionCheck = createVersionCheck({
  version: import.meta.env.VITE_APP_VERSION,
  interval: 5 * 60_000,
  enabled: !import.meta.env.DEV,
  onUpdated: () => appUpdate.configure({ webUpdated: true })
});

// Once a new web app is out, the next move inside the app loads it as a
// full page, so it arrives without a separate reload; never during a call.
const removeUpdateGuard = reloadNavigationsOnUpdate(router, {
  updated: () => appUpdate.webUpdated,
  inCall: () => callActivity.active
});

function checkForUpdate(): void {
  void versionCheck.check();
}

const cleanups: Array<() => void> = [];

onMounted(() => {
  theme.initTheme();
  void loadAccountBadges();
  // "How was the call?" asked by a leave on the page before this load.
  callFeedback.restorePendingCallFeedback();
  const policy = applyDesktopBoundaryToDocument();
  desktopAllowed.value = policy.desktopAllowed;
  roomClientAllowed.value = policy.roomClientAllowed;
  boundaryReady.value = true;
  // Game mode and wake-ups from the desktop app; nothing in a browser.
  // The realtime module loads lazily: pages without a socket never need it.
  cleanups.push(
    bindDesktopSystem({
      onWake: () => void import('@/api/realtime').then((realtime) => realtime.getAppRealtime().probeLiveness())
    })
  );
  // Emoji drawn as artwork copy as their characters anywhere in the app.
  cleanups.push(installEmojiCopy());
  cleanups.push(appUpdate.bind());
  // Besides the periodic poll, look for a new version when the tab comes back
  // into view, after the realtime socket reconnects (a deploy restarts the
  // server, so a reconnect is when a new version is likely) and when the
  // server sends data this build's contract does not know.
  const onVisibility = () => {
    if (document.visibilityState === 'visible') checkForUpdate();
  };
  document.addEventListener('visibilitychange', onVisibility);
  cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));
  cleanups.push(onContractViolation(checkForUpdate));
  let stopRestore: (() => void) | null = null;
  let unmounted = false;
  void import('@/api/realtime').then((realtime) => {
    if (!unmounted) stopRestore = realtime.getAppRealtime().onRestore(checkForUpdate);
  });
  cleanups.push(() => {
    unmounted = true;
    stopRestore?.();
  });
});

onBeforeUnmount(() => {
  removeUpdateGuard();
  versionCheck.stop();
  for (const cleanup of cleanups.splice(0)) cleanup();
});
</script>

<template>
  <main v-if="!boundaryReady" class="device-boundary" aria-label="Проверка устройства" aria-busy="true">
    <section class="device-boundary__card">
      <p class="device-boundary__text">Проверяем устройство</p>
      <h1 class="device-boundary__title">VoiceRoom запускается</h1>
    </section>
  </main>
  <template v-else-if="allowed">
    <RouterView />
    <AppUpdateNotice :in-call="callActivity.active" />
    <!-- The leave screen asks the question itself, as the bottom of its own window. -->
    <CallFeedbackPrompt :hidden="callActivity.active || leaveScreen.open" />
  </template>
  <main v-else class="device-boundary" aria-label="Неподдерживаемое устройство" aria-live="polite">
    <section class="device-boundary__card">
      <p class="device-boundary__text">Desktop only</p>
      <h1 class="device-boundary__title">Откройте VoiceRoom на компьютере</h1>
      <p class="device-boundary__text">
        Мобильный клиент не запускает сессию, realtime, голос, медиа или push-уведомления.
      </p>
    </section>
  </main>
</template>
