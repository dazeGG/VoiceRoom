<script setup lang="ts">
import { nextTick, onMounted, onBeforeUnmount, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionStore } from '@/features/auth/session.store';
import { useRoomNavigationStore } from '@/features/home/model/room-navigation.store';
import { useToastsStore } from '@/features/home/model/toasts.store';
import { usePageStore } from '@/stores/page.store';
import { getAppRealtime } from '@/api/realtime';
import { t } from '@/shared/i18n';
import { retainMobileFriendCallRealtime } from '@/platform/desktop-boundary';
import { APP_HOME, LEGACY_APP_HOME, dmPath, DM_CALL_CHAT_HASH } from '@/shared/app-home';
import { shallowPush, shallowReplace } from '@/shared/utils/shallow-routing';
import IncomingCallStack from './IncomingCallStack.vue';
import { useFriendCallStore } from './friend-call.store';
import { useFriendCallEngine } from './use-friend-call-engine';

const calls = useFriendCallStore();
const navigation = useRoomNavigationStore();
const session = useSessionStore();
const router = useRouter();
const page = usePageStore();
const toasts = useToastsStore();
const { mobile } = defineProps<{ mobile?: boolean }>();
useFriendCallEngine();
let stopSessionEnded: (() => void) | undefined;
const isLobbyRoute = () => {
  const id = router.currentRoute.value.meta.routeId;
  return id === LEGACY_APP_HOME || (!mobile && id === '/r/[roomId]');
};

onMounted(() => {
  stopSessionEnded = getAppRealtime().onSessionEnded(() => {
    if (isLobbyRoute() || session.consumeExpectedSessionEnd() || !session.user) return;
    session.clearSession();
    toasts.pushToast(t('Сеанс на этом устройстве завершён. Войдите снова'));
  });
});
onBeforeUnmount(() => stopSessionEnded?.());

watch(
  () => session.user?.id,
  (id, _, onCleanup) => {
    if (!id) return;
    onCleanup(
      calls.startSession(id, {
        ...(mobile && { retainMobileRealtime: retainMobileFriendCallRealtime }),
        async prepareVoice() {
          if (mobile && router.currentRoute.value.meta.routeId === '/r/[roomId]') {
            await router.replace(APP_HOME);
          }
          navigation.clearViewedRoom();
          navigation.clearEmbeddedRoom();
          await nextTick();
          page.screen = 'start';
        },
        openCall(peerId) {
          const current = router.currentRoute.value;
          const path = dmPath(peerId);
          if (current.fullPath === path) return;
          if (current.path === APP_HOME && current.query.dm === peerId && current.hash === DM_CALL_CHAT_HASH) {
            void shallowReplace(router, path);
            return;
          }
          if (isLobbyRoute()) {
            void shallowPush(router, path);
          } else void router.push(path);
        }
      })
    );
  },
  { immediate: true, flush: 'sync' }
);
</script>

<template>
  <IncomingCallStack v-if="session.user" />
</template>
