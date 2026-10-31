<script setup lang="ts">
// What /r/:roomId shows on a load or a real navigation: the lobby for a
// signed-in desktop visit, the room itself for a guest or a phone.
import { computed, onMounted, ref, watch } from 'vue';
import { useSessionStore } from '@/features/auth/session.store';
import { signOut } from '@/features/home/model/sign-out';
import { useToastsStore, type ToastOptions } from '@/features/home/model/toasts.store';
import { loadRoomPage } from '@/features/room/prefetch';
import { lazyPage } from '@/shared/components/lazy-page';
import { MascotIcon, ToastStack } from '@/shared/ui';
import { ProfileCardHost } from '@/features/home/components/profile-card';
import OpenInAppScreen from '@/features/home/components/OpenInAppScreen.vue';
import { applyDesktopBoundaryToDocument } from '@/platform/desktop-boundary';
import {
  buildAppRoomLink,
  consumeInAppRoomNavigation,
  launchAppLink,
  readOpenInAppSignals,
  shouldOfferOpenInApp
} from '@/platform/open-in-app';
import { usePageHead } from './use-page-head';

const props = defineProps<{ roomId: string }>();

// Both pages are chunks of their own, so the landing does not ship them. The
// room page, which the lobby embeds too, loads beside the session check; the
// lobby only once the session says this visit is signed in.
const LobbyPage = lazyPage(() => import('@/features/home/LobbyPage.vue'));
const RoomPage = lazyPage(loadRoomPage);

usePageHead('VoiceRoom');

const session = useSessionStore();
const toasts = useToastsStore();

const boundaryReady = ref(false);
const desktopAllowed = ref(false);
// A phone may open this page: the room itself works in a mobile browser, but a
// signed-in phone gets the standalone room, never the desktop lobby.
const roomAllowed = ref(false);
const loggingOut = ref(false);
const authLoadError = ref(false);
const guestContinuedInBrowser = ref(false);
let guestAppLaunched = false;
const inAppNavigation = ref(false);
// Guests auto-join as soon as RoomPage mounts, so the offer is decided before
// it renders. Signed-in users get the same offer from LobbyPage.
const guestOpenInApp = computed(
  () =>
    boundaryReady.value &&
    session.loaded &&
    !session.user &&
    !authLoadError.value &&
    Boolean(props.roomId) &&
    !guestContinuedInBrowser.value &&
    !inAppNavigation.value &&
    shouldOfferOpenInApp(readOpenInAppSignals())
);

watch(guestOpenInApp, (offer) => {
  if (!offer || guestAppLaunched) return;
  guestAppLaunched = true;
  openGuestRoomInApp();
});

function openGuestRoomInApp(): void {
  const link = buildAppRoomLink(props.roomId, window.location.hostname);
  if (link) launchAppLink(link);
  else guestContinuedInBrowser.value = true;
}

onMounted(() => {
  // Read before boundaryReady so the offer below never sees a stale mark.
  inAppNavigation.value = consumeInAppRoomNavigation();
  const policy = applyDesktopBoundaryToDocument();
  desktopAllowed.value = policy.desktopAllowed;
  roomAllowed.value = policy.roomClientAllowed;
  boundaryReady.value = true;
  if (!policy.roomClientAllowed) return;
  loadRoomPage().catch(() => {});

  void session.loadSession().catch(() => {
    authLoadError.value = true;
  });
});

function showToast(message: string, options?: ToastOptions): void {
  toasts.pushToast(message, options);
}

function retrySessionLoad(): void {
  if (!session.loaded) return;
  authLoadError.value = false;
  session.loaded = false;
  void session.loadSession(true).catch(() => {
    authLoadError.value = true;
  });
}

async function handleLogout(): Promise<void> {
  if (loggingOut.value) return;
  loggingOut.value = true;
  try {
    await signOut();
    showToast('Вы вышли из аккаунта');
  } catch (error) {
    showToast(error instanceof Error && error.message ? error.message : 'Не удалось выйти');
  } finally {
    loggingOut.value = false;
  }
}
</script>

<template>
  <div v-if="!boundaryReady" class="app-shell">
    <main class="auth-loader" aria-label="Проверка устройства" aria-busy="true">
      <div class="auth-loader__card">
        <span class="auth-loader__orb"><MascotIcon variant="look" :size="52" /></span>
        <p class="auth-loader__kicker">Проверяем устройство</p>
        <h1 class="auth-loader__title">VoiceRoom запускается</h1>
      </div>
    </main>
  </div>
  <div v-else-if="!roomAllowed" class="app-shell">
    <main class="auth-session-error" aria-label="Неподдерживаемое устройство" aria-live="polite">
      <div class="auth-session-error__card">
        <p class="auth-session-error__kicker">Desktop only</p>
        <h1 class="auth-session-error__title">Откройте комнату на компьютере</h1>
        <p class="auth-session-error__text">
          Мобильные браузеры не подключаются к realtime, LiveKit, медиа и push-инфраструктуре VoiceRoom.
        </p>
      </div>
    </main>
  </div>
  <div v-else-if="!session.loaded" class="app-shell">
    <main class="auth-loader" aria-label="Загрузка аккаунта" aria-busy="true">
      <div class="auth-loader__card">
        <span class="auth-loader__orb"><MascotIcon variant="look" :size="52" /></span>
        <p class="auth-loader__kicker">Проверяем сессию</p>
        <h1 class="auth-loader__title">Открываем комнату</h1>
      </div>
    </main>
  </div>
  <div v-else-if="authLoadError" class="app-shell">
    <main class="auth-session-error" aria-label="Ошибка проверки аккаунта" aria-live="polite">
      <div class="auth-session-error__card">
        <p class="auth-session-error__kicker">Сессия не проверена</p>
        <h1 class="auth-session-error__title">Не удалось проверить аккаунт</h1>
        <p class="auth-session-error__text">
          Проверьте подключение к серверу и повторите попытку. Мы не будем открывать комнату как гостевую, пока проверка
          не пройдет.
        </p>
        <button type="button" @click="retrySessionLoad">Повторить</button>
      </div>
    </main>
  </div>
  <LobbyPage
    v-else-if="session.user && desktopAllowed"
    :user="session.user"
    :logging-out="loggingOut"
    @logout="handleLogout"
    @toast="showToast"
  />
  <OpenInAppScreen v-else-if="guestOpenInApp" @retry="openGuestRoomInApp" @continue="guestContinuedInBrowser = true" />
  <template v-else>
    <RoomPage :key="roomId" :room-id="roomId" auto-join />
    <!-- The lobby mounts its own host; a second one would fight it for the card. -->
    <ProfileCardHost @toast="(message: string) => showToast(message)" />
  </template>

  <ToastStack :toasts="toasts.items" :on-dismiss="toasts.dismissToast" />
</template>
