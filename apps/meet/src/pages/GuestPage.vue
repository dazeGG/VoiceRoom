<script setup lang="ts">
import { ArrowRight, Link2Off, LogOut, UsersRound } from '@lucide/vue';
import { createGuestJoinController } from '@voice-room/call/guest';
import { Button, Callout, Field, TextField } from '@voice-room/ui/components';
import { t } from '@voice-room/ui/i18n';
import { cleanDisplayName, normalizeRoomId } from '@voice-room/shared/validation';
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import MeetCall from '@/components/MeetCall.vue';
import { useMeetStore } from '@/meet.store';

const props = defineProps<{ roomId: string }>();
const meet = useMeetStore();
const statusLifetime = new AbortController();
const controller = createGuestJoinController({
  roomId: normalizeRoomId(props.roomId),
  status: (roomId) => meet.api.status(roomId, statusLifetime.signal),
  setDisplayName: meet.identity.setDisplayName,
  admissionCapabilities: meet.transport.capabilities
});
const { phase, failure, capabilities } = controller;
const name = ref(meet.identity.displayName());
const nameInvalid = ref(false);
const nameInput = useTemplateRef<{ input: HTMLInputElement | null }>('nameInput');
const heading = useTemplateRef<HTMLHeadingElement>('heading');
const inCall = computed(() => phase.value === 'call' || phase.value === 'reconnecting');

onMounted(() => void controller.check());
onBeforeUnmount(() => {
  statusLifetime.abort();
  controller.dispose();
  meet.transport.disconnect();
});

watch(heading, (element) => element?.focus(), { flush: 'post' });

function join(): void {
  const displayName = cleanDisplayName(name.value);
  nameInvalid.value = !displayName;
  if (!displayName) {
    nameInput.value?.input?.focus();
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
        <div class="meet-card__icon"><LogOut aria-hidden="true" /></div>
        <h1 ref="heading" tabindex="-1">{{ t('meet.left') }}</h1>
        <p>{{ t('meet.leftDescription') }}</p>
        <Button size="lg" variant="primary" @click="controller.check()">{{ t('meet.rejoin') }}</Button>
        <RouterLink class="ui-button ui-button--outline ui-button--size-lg meet-card__link" to="/">
          {{ t('meet.home') }}
        </RouterLink>
      </template>
      <template v-else-if="phase === 'not-found' || phase === 'closed'">
        <div class="meet-card__icon"><Link2Off aria-hidden="true" /></div>
        <h1 ref="heading" tabindex="-1">{{ t('meet.missing') }}</h1>
        <p>{{ t('meet.missingDescription') }}</p>
        <RouterLink class="ui-button ui-button--outline ui-button--size-lg meet-card__link" to="/">
          {{ t('meet.home') }}
        </RouterLink>
      </template>
      <template v-else>
        <div class="meet-card__icon"><UsersRound aria-hidden="true" /></div>
        <h1>{{ t('meet.join') }}</h1>
        <p v-if="phase === 'checking'" role="status">{{ t('meet.checking') }}</p>
        <template v-else-if="phase === 'error' && failure === 'status'">
          <Callout role="alert" tone="danger" :title="t('meet.error.unavailable')" />
          <Button size="lg" variant="primary" @click="controller.check()">{{ t('meet.retry') }}</Button>
        </template>
        <template v-else>
          <p>{{ t('meet.joinDescription') }}</p>
          <form class="meet-card__fields" method="post" @submit.prevent="join">
            <Field id="display-name" :label="t('meet.name')">
              <TextField
                ref="nameInput"
                v-model="name"
                size="lg"
                name="display-name"
                maxlength="40"
                autocomplete="off"
                enterkeyhint="go"
                required
                :readonly="phase === 'joining'"
                :aria-invalid="nameInvalid"
                :aria-describedby="nameInvalid ? 'name-error' : undefined"
                @input="nameInvalid = false"
              />
            </Field>
            <Callout v-if="nameInvalid" id="name-error" role="alert" tone="danger" :title="t('meet.nameRequired')" />
            <Callout v-else-if="failure === 'join'" role="alert" tone="danger" :title="t('meet.error.join')" />
            <Button size="lg" variant="primary" type="submit" :busy="phase === 'joining'">
              {{ t(phase === 'joining' ? 'meet.joining' : 'meet.join') }}
              <ArrowRight v-if="phase !== 'joining'" aria-hidden="true" />
            </Button>
          </form>
        </template>
      </template>
    </section>
  </main>
</template>
