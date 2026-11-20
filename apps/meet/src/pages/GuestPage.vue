<script setup lang="ts">
import { ArrowRight, Link2Off, LogOut, UsersRound } from '@lucide/vue';
import { createGuestJoinController } from '@voice-room/call/guest';
import { t } from '@voice-room/ui/i18n';
import { cleanDisplayName, normalizeRoomId } from '@voice-room/shared/validation';
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import MeetCall from '@/components/MeetCall.vue';
import { useMeetStore } from '@/meet.store';

const props = defineProps<{ roomId: string }>();
const meet = useMeetStore();
const controller = createGuestJoinController({
  roomId: normalizeRoomId(props.roomId),
  status: meet.api.status,
  setDisplayName: meet.identity.setDisplayName,
  admissionCapabilities: meet.transport.capabilities
});
const { phase, failure, capabilities } = controller;
const name = ref(meet.identity.displayName());
const nameInvalid = ref(false);
const nameInput = useTemplateRef<HTMLInputElement>('nameInput');
const heading = useTemplateRef<HTMLHeadingElement>('heading');
const inCall = computed(() => phase.value === 'call' || phase.value === 'reconnecting');

onMounted(() => void controller.check());
onBeforeUnmount(() => {
  controller.dispose();
  meet.transport.disconnect();
});

watch(heading, (element) => element?.focus(), { flush: 'post' });

function join(): void {
  const displayName = cleanDisplayName(name.value);
  nameInvalid.value = !displayName;
  if (!displayName) {
    nameInput.value?.focus();
    return;
  }
  void controller.join(displayName);
}
</script>

<template>
  <MeetCall
    v-if="inCall"
    :capabilities="capabilities"
    :reconnecting="phase === 'reconnecting'"
    @leave="controller.leave"
  />
  <main v-else class="meet-entry">
    <section class="meet-card" :aria-busy="phase === 'checking' || phase === 'joining'">
      <template v-if="phase === 'left'">
        <div class="meet-card__icon"><LogOut :size="26" aria-hidden="true" /></div>
        <h1 ref="heading" tabindex="-1">{{ t('meet.left') }}</h1>
        <p>{{ t('meet.leftDescription') }}</p>
        <button class="meet-button" type="button" @click="controller.check()">{{ t('meet.rejoin') }}</button>
        <RouterLink class="meet-button meet-button--secondary" to="/">{{ t('meet.home') }}</RouterLink>
      </template>
      <template v-else-if="phase === 'not-found' || phase === 'closed'">
        <div class="meet-card__icon"><Link2Off :size="26" aria-hidden="true" /></div>
        <h1 ref="heading" tabindex="-1">{{ t('meet.missing') }}</h1>
        <p>{{ t('meet.missingDescription') }}</p>
        <RouterLink class="meet-button meet-button--secondary" to="/">{{ t('meet.home') }}</RouterLink>
      </template>
      <template v-else>
        <div class="meet-card__icon"><UsersRound :size="26" aria-hidden="true" /></div>
        <h1>{{ t('meet.join') }}</h1>
        <p v-if="phase === 'checking'" role="status">{{ t('meet.checking') }}</p>
        <template v-else-if="phase === 'error' && failure === 'status'">
          <p class="meet-card__error" role="alert">{{ t('meet.error.unavailable') }}</p>
          <button class="meet-button" type="button" @click="controller.check()">{{ t('meet.retry') }}</button>
        </template>
        <template v-else>
          <p>{{ t('meet.joinDescription') }}</p>
          <form class="meet-card__fields" method="post" @submit.prevent="join">
            <label class="meet-card__label" for="display-name">{{ t('meet.name') }}</label>
            <input
              id="display-name"
              ref="nameInput"
              v-model="name"
              name="display-name"
              class="meet-card__input"
              maxlength="40"
              autocomplete="off"
              enterkeyhint="go"
              required
              :readonly="phase === 'joining'"
              :aria-invalid="nameInvalid"
              :aria-describedby="nameInvalid ? 'name-error' : undefined"
              @input="nameInvalid = false"
            />
            <p v-if="nameInvalid" id="name-error" class="meet-card__error" role="alert">{{ t('meet.nameRequired') }}</p>
            <p v-else-if="failure === 'join'" class="meet-card__error" role="alert">{{ t('meet.error.join') }}</p>
            <button class="meet-button" type="submit" :disabled="phase === 'joining'">
              {{ t(phase === 'joining' ? 'meet.joining' : 'meet.join') }}
              <ArrowRight :size="18" aria-hidden="true" />
            </button>
          </form>
        </template>
      </template>
    </section>
  </main>
</template>
