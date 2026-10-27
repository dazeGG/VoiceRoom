<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { addRoomByCode } from '@/api/auth';
import AuthDialog from '@/features/auth/AuthDialog.vue';
import type { AuthMode } from '@/features/auth/auth-mode';
import CallFeedbackCard from '@/features/call-feedback/CallFeedbackCard.vue';
import { useCallFeedbackStore } from '@/features/call-feedback/call-feedback.store';
import { useLeaveScreenStore } from '@/features/room/leave-screen.store';
import { getDesktopBoundaryPolicy } from '@/platform/desktop-boundary';
import { createLogger, errorContext } from '@/shared/log';
import { Button } from '@/shared/ui';

const log = createLogger('room:leave');

const leaveScreen = useLeaveScreenStore();
const feedback = useCallFeedbackStore();

const authMode = ref<AuthMode | null>(null);
// `/` is desktop-only, so a phone never leaves this page on its own.
const mobile = ref(false);
const accountCreated = ref(false);
const feedbackThanked = ref(false);

onMounted(() => {
  mobile.value = !getDesktopBoundaryPolicy().desktopAllowed;
});

const offerAccount = computed(() => leaveScreen.guest && !accountCreated.value);
// "How was the call?" is the bottom of this window rather than a second one.
const feedbackCall = computed(() => feedback.call);

// Svelte: {#key feedbackCall}. A new call mounts a new card with nothing chosen.
const feedbackKey = ref(0);
watch(feedbackCall, () => feedbackKey.value++);

// Leaving the window with the question unanswered is passing on it, so the
// next page does not ask it again.
function goHome(): void {
  feedback.skipCallFeedback();
  window.location.href = '/';
}

function rejoin(): void {
  feedback.skipCallFeedback();
  window.location.href = `/r/${encodeURIComponent(leaveScreen.roomId)}`;
}

// A permanent room is saved to the new account, so «вернётесь сюда» is true.
// A temporary room is deleted once empty and promises nothing.
async function afterAccountCreated(): Promise<void> {
  if (leaveScreen.isStatic && leaveScreen.roomId) {
    try {
      await addRoomByCode(leaveScreen.roomId);
    } catch (error) {
      log.error('save left room to new account failed', errorContext(error));
    }
  }
  if (mobile.value) {
    authMode.value = null;
    accountCreated.value = true;
    return;
  }
  goHome();
}
</script>

<template>
  <div v-if="leaveScreen.open" class="leave-screen" role="dialog" aria-modal="true" aria-labelledby="leaveScreenTitle">
    <div class="leave-screen__card">
      <h1 id="leaveScreenTitle" class="leave-screen__title">
        {{ accountCreated ? 'Аккаунт создан' : 'Вы вышли из комнаты' }}
      </h1>
      <template v-if="offerAccount">
        <p v-if="leaveScreen.isStatic" class="leave-screen__text">
          Создайте аккаунт, и эта комната сохранится у вас: вернётесь сюда без ссылки.
        </p>
        <p v-else class="leave-screen__text">
          С аккаунтом у вас будут свои постоянные комнаты, друзья и личные сообщения.
        </p>
      </template>
      <p v-else class="leave-screen__text">
        Лобби, друзья и личные сообщения — на компьютере. С телефона можно вернуться в эту комнату.
      </p>
      <div class="leave-screen__actions">
        <template v-if="offerAccount">
          <Button variant="primary" type="button" @click="authMode = 'register'">Создать аккаунт</Button>
          <Button v-if="mobile" variant="ghost" type="button" @click="rejoin">Вернуться в звонок</Button>
          <Button v-else variant="ghost" type="button" @click="goHome">Не сейчас</Button>
        </template>
        <Button v-else variant="primary" type="button" @click="rejoin">Вернуться в звонок</Button>
      </div>
      <template v-if="feedbackCall">
        <hr class="leave-screen__divider" />
        <CallFeedbackCard :key="feedbackKey" :call="feedbackCall" hosted @answered="feedbackThanked = true" />
      </template>
      <template v-else-if="feedbackThanked">
        <hr class="leave-screen__divider" />
        <p class="leave-screen__text leave-screen__thanks" role="status">
          Спасибо за отзыв! Это помогает делать звонки лучше.
        </p>
      </template>
    </div>
  </div>

  <AuthDialog
    v-if="authMode"
    v-model:mode="authMode"
    :on-authenticated="afterAccountCreated"
    @close="authMode = null"
  />
</template>
