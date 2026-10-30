<script setup lang="ts">
import { MonitorDown, UserPlus, X } from '@lucide/vue';
import { computed, onMounted, ref } from 'vue';
import AuthDialog from '@/features/auth/AuthDialog.vue';
import type { AuthMode } from '@/features/auth/auth-mode';
import { useSessionStore } from '@/features/auth/session.store';
import { getDesktopBoundaryPolicy } from '@/platform/desktop-boundary';
import { readOpenInAppSignals, shouldOfferOpenInApp } from '@/platform/open-in-app';
import AppBenefitsModal from '@/shared/components/AppBenefitsModal.vue';
import { Button } from '@/shared/ui';
import { iconMd, iconSm } from '@/shared/ui/icons';
import { isRoomEmbedded } from '../client/core/embed';
import { state as roomClientState } from '../client/core/room-runtime.store';
import { rejoinRoomSignedIn } from '../client/room/room';
import { resolveRoomCta } from '../room-cta';

const session = useSessionStore();

// Decided once per page: the platform does not change under a visit.
const appAvailable = ref(false);
const embedded = ref(false);
const mobile = ref(false);
const dismissed = ref(false);
const authMode = ref<AuthMode | null>(null);
const benefitsOpen = ref(false);

onMounted(() => {
  appAvailable.value = shouldOfferOpenInApp(readOpenInAppSignals());
  embedded.value = isRoomEmbedded();
  mobile.value = !getDesktopBoundaryPolicy().desktopAllowed;
});

const cta = computed(() =>
  resolveRoomCta({
    joined: roomClientState.joined,
    guest: !embedded.value && !session.user,
    appAvailable: appAvailable.value,
    hasUsedDesktopApp: session.user?.hasUsedDesktopApp ?? false,
    dismissed: dismissed.value
  })
);

// One promise per offer: a headline worth reading, and the reason under it.
const copy = computed(() => {
  if (cta.value === 'app') {
    return {
      label: 'Скачать приложение',
      title: 'В приложении звонок удобнее',
      text: 'Оверлей поверх игр, горячие клавиши и push-to-talk',
      action: 'Скачать'
    };
  }
  if (roomClientState.roomIsStatic) {
    return {
      label: 'Создать аккаунт',
      title: 'Сохраните эту комнату за собой',
      text: 'С аккаунтом она останется в списке — вернётесь без ссылки',
      action: 'Создать аккаунт'
    };
  }
  return {
    label: 'Создать аккаунт',
    title: 'Заберите этот звонок с собой',
    text: 'Свои комнаты, друзья и личные сообщения — в одном аккаунте',
    action: 'Создать аккаунт'
  };
});

function rejoin(): Promise<void> {
  return rejoinRoomSignedIn(roomClientState.roomId);
}

function accept(): void {
  if (cta.value === 'account') authMode.value = 'register';
  else benefitsOpen.value = true;
}
</script>

<template>
  <div v-if="cta || (mobile && roomClientState.joined)" class="room-cta-slot">
    <aside v-if="cta" :class="['room-cta-slot__card', `room-cta-slot__card--${cta}`]" :aria-label="copy.label">
      <span class="room-cta-slot__icon" aria-hidden="true">
        <UserPlus v-if="cta === 'account'" v-bind="iconMd" />
        <MonitorDown v-else v-bind="iconMd" />
      </span>
      <div class="room-cta-slot__copy">
        <strong class="room-cta-slot__title">{{ copy.title }}</strong>
        <span class="room-cta-slot__text">{{ copy.text }}</span>
      </div>
      <Button class="ui-button--compact room-cta-slot__action" variant="primary" type="button" @click="accept">{{
        copy.action
      }}</Button>
      <button
        class="room-cta-slot__close"
        type="button"
        aria-label="Скрыть до следующего захода"
        @click="dismissed = true"
      >
        <X v-bind="iconSm" aria-hidden="true" />
      </button>
    </aside>
    <!-- A mobile browser suspends the microphone when it leaves the foreground. -->
    <p v-if="mobile && roomClientState.joined" class="room-cta-slot__hint" role="note">
      Звонок идёт, пока браузер открыт и экран включён
    </p>
  </div>

  <AuthDialog v-if="authMode" v-model:mode="authMode" :on-authenticated="rejoin" @close="authMode = null" />

  <AppBenefitsModal :open="benefitsOpen" @close="benefitsOpen = false" />
</template>
