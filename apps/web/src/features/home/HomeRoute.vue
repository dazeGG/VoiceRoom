<script setup lang="ts">
import { Callout } from '@voiceroom/ui-kit/components';
// The app entry shows the lobby or landing on desktop. Phones with a signed-in
// call session can open the lobby and everyone else can start a temporary room.
import { t } from '@/shared/i18n';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { applyDesktopBoundaryToDocument } from '@/platform/desktop-boundary';
import { useSessionStore } from '@/features/auth/session.store';
import { useFriendCallStore } from '@/features/friend-call/friend-call.store';
import HomePage from './HomePage.vue';
import MobileStartScreen from './components/MobileStartScreen.vue';
import { takeStartRoomRequest } from './model/start-room-request';
import { useToastsStore } from './model/toasts.store';

const toasts = useToastsStore();
const session = useSessionStore();
const calls = useFriendCallStore();
// The public site's «Создать комнату» came here to make the room at once.
const startRoom = takeStartRoomRequest(useRoute(), useRouter());

const boundaryReady = ref(false);
const desktopAllowed = ref(false);
const roomClientAllowed = ref(false);
const mobileLobby = computed(() => Boolean(session.user && (calls.enabled || calls.voice || calls.closingCallId)));
const checkingMobileSession = computed(
  () => !session.loaded || (session.user && !calls.missedLoaded && !calls.enabled)
);

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
  if (!policy.desktopAllowed && policy.roomClientAllowed && !startRoom) void session.loadSession().catch(() => {});
});

onBeforeUnmount(() => {
  document.title = previousTitle;
  themeColor.remove();
});
</script>

<template>
  <div
    v-if="!boundaryReady || (roomClientAllowed && !desktopAllowed && !startRoom && checkingMobileSession)"
    class="app-shell"
  >
    <main class="auth-loader" :aria-label="t('Проверка устройства')" aria-busy="true">
      <div class="auth-loader__card">
        <p class="auth-loader__kicker">{{ t('Проверяем устройство') }}</p>
        <h1 class="auth-loader__title">{{ t('VoiceRoom запускается') }}</h1>
      </div>
    </main>
  </div>
  <HomePage v-else-if="desktopAllowed || mobileLobby" :start-room="startRoom" />
  <template v-else-if="roomClientAllowed">
    <MobileStartScreen :start-room="startRoom" @toast="toasts.pushToast" />
  </template>
  <div v-else class="app-shell">
    <main class="auth-session-error" :aria-label="t('Неподдерживаемое устройство')" aria-live="polite">
      <div class="auth-session-error__card">
        <p class="auth-session-error__context">{{ t('Только для компьютера') }}</p>
        <Callout
          title-as="h1"
          tone="warning"
          :title="t('Откройте VoiceRoom на компьютере')"
          :text="
            t('Мобильные браузеры не запускают этот клиент: realtime, голос, медиа и push-уведомления здесь отключены.')
          "
        />
      </div>
    </main>
  </div>
</template>
