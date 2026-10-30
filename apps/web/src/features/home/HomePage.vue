<script setup lang="ts">
import { ArrowRight } from '@lucide/vue';
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { createRoom } from '@/api/rooms';
import type { AuthUser } from '@/api/auth';
import AuthDialog from '@/features/auth/AuthDialog.vue';
import type { AuthMode } from '@/features/auth/auth-mode';
import { useSessionStore } from '@/features/auth/session.store';
import { markInAppRoomNavigation } from '@/platform/open-in-app';
import LegalLinks from '@/shared/components/LegalLinks.vue';
import Topbar from '@/shared/components/Topbar.vue';
import { MascotIcon, ToastStack } from '@/shared/ui';
import { extractRoomId } from '@/shared/utils/room';
import { usePageStore } from '@/stores/page.store';
import DesktopAppCard from './components/DesktopAppCard.vue';
import LandingHero from './components/LandingHero.vue';
import PermanentRoomOfferDialog from './components/PermanentRoomOfferDialog.vue';
import { dismissPermanentRoomOffer, rememberGuestRoomCreated, shouldOfferPermanentRoom } from './model/returning-guest';
import { usePushNotificationsStore } from './model/push-notifications.store';
import { signOut } from './model/sign-out';
import { useToastsStore, type ToastOptions } from './model/toasts.store';

const props = withDefaults(defineProps<{ initialAuthMode?: AuthMode | null }>(), { initialAuthMode: null });

// Only a signed-in visit shows the lobby; a guest's landing does not download it.
const LobbyPage = defineAsyncComponent(() => import('./LobbyPage.vue'));

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const page = usePageStore();
const toasts = useToastsStore();
const push = usePushNotificationsStore();

const roomCode = ref('');
const creatingTemp = ref(false);
const joining = ref(false);
const loggingOut = ref(false);
const authLoadError = ref(false);
const permanentRoomOfferOpen = ref(false);
// The sign-in dialog opened from the offer; it is not the one in the URL,
// because it ends in the lobby's new-room dialog, not on the bare lobby.
const offerAuthMode = ref<AuthMode | null>(null);
const createRoomInLobby = ref(false);

const user = computed(() => session.user);
const authMode = computed<AuthMode | null>(() => {
  const requestedMode = route.query.auth;
  if (requestedMode === 'login' || requestedMode === 'register' || requestedMode === 'recover') return requestedMode;
  return props.initialAuthMode;
});

watch(
  () => user.value?.id ?? null,
  (userId) => {
    void push.syncPushNotificationState(userId);
  },
  { immediate: true }
);

// The new-room dialog greets only the sign-in made from the offer; after a
// sign-out the page stays, and a later plain sign-in opens the bare lobby.
watch(
  user,
  (current) => {
    if (!current) createRoomInLobby.value = false;
  },
  { immediate: true }
);

onMounted(() => {
  page.screen = 'start';
  void session.loadSession().catch(() => {
    authLoadError.value = true;
  });
});

onBeforeUnmount(() => {
  page.screen = '';
});

function retrySessionLoad(): void {
  if (!session.loaded) return;
  authLoadError.value = false;
  session.loaded = false;
  void session.loadSession(true).catch(() => {
    authLoadError.value = true;
  });
}

function handleCreateTemp(): void {
  if (creatingTemp.value) return;
  if (shouldOfferPermanentRoom()) {
    permanentRoomOfferOpen.value = true;
    return;
  }
  void createTempRoom();
}

function continueAsGuest(): void {
  permanentRoomOfferOpen.value = false;
  dismissPermanentRoomOffer();
  void createTempRoom();
}

function registerFromOffer(): void {
  permanentRoomOfferOpen.value = false;
  offerAuthMode.value = 'register';
}

// The account came for a room whose link stays, so the lobby opens with the
// new-room dialog, permanent by default.
function afterOfferAuthenticated(account: AuthUser): void {
  offerAuthMode.value = null;
  createRoomInLobby.value = true;
  session.setUser(account);
}

async function createTempRoom(): Promise<void> {
  if (creatingTemp.value) return;
  creatingTemp.value = true;
  try {
    const roomId = await createRoom({ isStatic: false });
    rememberGuestRoomCreated();
    openRoom(roomId);
  } catch (error) {
    creatingTemp.value = false;
    showToast(error instanceof Error && error.message ? error.message : 'Не удалось создать комнату');
  }
}

function handleJoinRoom(): void {
  if (joining.value) return;
  const roomId = extractRoomId(roomCode.value);
  if (!roomId) {
    showToast('Введите код комнаты');
    return;
  }
  joining.value = true;
  openRoom(roomId);
}

async function handleLogout(): Promise<void> {
  if (loggingOut.value) return;
  loggingOut.value = true;
  try {
    await signOut();
    showToast('Вы вышли из аккаунта');
  } catch (error) {
    showToast(error instanceof Error && error.message ? error.message : 'Не удалось выйти из аккаунта');
  } finally {
    loggingOut.value = false;
  }
}

function openRoom(roomId: string): void {
  markInAppRoomNavigation();
  window.location.href = `/r/${encodeURIComponent(roomId)}`;
}

function showToast(message: string, options?: ToastOptions): void {
  toasts.pushToast(message, options);
}

function closeAuthDialog(): void {
  void router.replace('/');
}

function switchAuthMode(mode: AuthMode): void {
  void router.replace({ path: '/', query: { auth: mode } });
}
</script>

<template>
  <div v-if="!session.loaded" class="app-shell">
    <Topbar label="VoiceRoom" />
    <main class="auth-loader" aria-label="Загрузка аккаунта" aria-busy="true">
      <div class="auth-loader__card">
        <span class="auth-loader__orb"><MascotIcon variant="blink" :size="52" /></span>
        <p class="auth-loader__kicker">Проверяем сессию</p>
        <h1 class="auth-loader__title">Готовим ваши комнаты</h1>
        <div class="auth-loader__lines" aria-hidden="true">
          <span class="auth-loader__line"></span><span class="auth-loader__line"></span
          ><span class="auth-loader__line"></span>
        </div>
      </div>
    </main>
  </div>
  <div v-else-if="authLoadError" class="app-shell">
    <Topbar label="VoiceRoom" />
    <main class="auth-session-error" aria-label="Ошибка проверки аккаунта" aria-live="polite">
      <div class="auth-session-error__card">
        <p class="auth-session-error__kicker">Сессия не проверена</p>
        <h1 class="auth-session-error__title">Не удалось проверить аккаунт</h1>
        <p class="auth-session-error__text">
          Проверьте подключение к серверу и повторите попытку. Мы не будем показывать лобби или сбрасывать сессию, пока
          проверка не пройдет.
        </p>
        <button type="button" @click="retrySessionLoad">Повторить</button>
      </div>
    </main>
  </div>
  <LobbyPage
    v-else-if="user"
    :user="user"
    :logging-out="loggingOut"
    :create-room-on-open="createRoomInLobby"
    @logout="handleLogout"
    @toast="showToast"
  />
  <div v-else class="app-shell">
    <div class="landing__container">
      <Topbar label="Новая голосовая комната">
        <nav class="landing__auth" aria-label="Аккаунт">
          <RouterLink class="landing__login" to="/?auth=login"
            >Войти <ArrowRight :size="15" aria-hidden="true"
          /></RouterLink>
        </nav>
      </Topbar>
    </div>

    <main id="startScreen" class="landing__layout" aria-label="Стартовый экран">
      <LandingHero
        v-model:room-code="roomCode"
        :creating-temp="creatingTemp"
        :joining="joining"
        @create-temp="handleCreateTemp"
        @join="handleJoinRoom"
      />
      <DesktopAppCard />
    </main>
    <footer class="landing__legal">
      <LegalLinks />
    </footer>
  </div>

  <AuthDialog
    v-if="session.loaded && !user && authMode"
    :key="authMode"
    :mode="authMode"
    @update:mode="switchAuthMode"
    @close="closeAuthDialog"
  />

  <PermanentRoomOfferDialog
    :open="permanentRoomOfferOpen && !user"
    @register="registerFromOffer"
    @continue="continueAsGuest"
    @close="permanentRoomOfferOpen = false"
  />

  <AuthDialog
    v-if="offerAuthMode && !user"
    :key="offerAuthMode"
    :mode="offerAuthMode"
    :on-authenticated="afterOfferAuthenticated"
    @update:mode="(mode: AuthMode) => (offerAuthMode = mode)"
    @close="offerAuthMode = null"
  />

  <ToastStack :toasts="toasts.items" :on-dismiss="toasts.dismissToast" />
</template>
