<script setup lang="ts">
import { ArrowRight, Check, Copy, Link2, Video } from '@lucide/vue';
import { Button, Callout, Field, TextField } from '@voice-room/ui/components';
import { t } from '@voice-room/ui/i18n';
import { ref, useTemplateRef } from 'vue';
import { MeetApiError } from '@/adapters/meet-api';
import { useMeetStore } from '@/meet.store';

const meet = useMeetStore();
const creating = ref(false);
const joinUrl = ref('');
const copied = ref(false);
const error = ref('');
const linkInput = useTemplateRef<{ input: HTMLInputElement | null }>('link');

async function createMeeting(): Promise<void> {
  if (creating.value) return;
  error.value = '';
  creating.value = true;
  try {
    const meeting = await meet.api.createMeeting();
    joinUrl.value = new URL(`/room/${encodeURIComponent(meeting.roomId)}`, window.location.origin).href;
  } catch (cause) {
    error.value = cause instanceof MeetApiError ? cause.message : t('meet.error.generic');
  } finally {
    creating.value = false;
  }
}

async function copyLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(joinUrl.value);
    copied.value = true;
  } catch {
    linkInput.value?.input?.focus();
    linkInput.value?.input?.select();
    error.value = t('meet.copyManually');
  }
}
</script>

<template>
  <main class="meet-entry">
    <section class="meet-card" :aria-busy="creating || meet.owner === 'checking'">
      <div class="meet-card__icon"><Video aria-hidden="true" /></div>
      <template v-if="joinUrl">
        <h1>{{ t('meet.created') }}</h1>
        <p>{{ t('meet.shareDescription') }}</p>
        <div class="meet-card__fields">
          <Field id="meeting-link" :label="t('meet.meetingLink')">
            <TextField ref="link" size="lg" type="url" :model-value="joinUrl" readonly />
          </Field>
          <Button size="lg" variant="primary" @click="copyLink">
            <template #icon>
              <Check v-if="copied" aria-hidden="true" />
              <Copy v-else aria-hidden="true" />
            </template>
            {{ t(copied ? 'meet.copied' : 'meet.copyLink') }}
          </Button>
          <Button variant="plain" size="lg" class="meet-card__link" :href="joinUrl">
            {{ t('meet.openMeeting') }} <ArrowRight aria-hidden="true" />
          </Button>
        </div>
        <span v-if="copied" class="meet-shell__sr-only" role="status">{{ t('meet.copied') }}</span>
      </template>
      <template v-else-if="meet.owner === 'ready'">
        <h1>{{ t('meet.createTitle') }}</h1>
        <p>{{ t('meet.createDescription') }}</p>
        <Button size="lg" variant="primary" :busy="creating" @click="createMeeting">
          {{ t(creating ? 'meet.creating' : 'meet.create') }}
          <ArrowRight v-if="!creating" aria-hidden="true" />
        </Button>
      </template>
      <template v-else>
        <h1>VoiceRoom Meet</h1>
        <p v-if="meet.owner === 'checking'" role="status">{{ t('meet.checkingOwner') }}</p>
        <Callout v-else-if="meet.owner === 'rejected'" role="alert" tone="danger" :title="t('meet.error.ownerLink')" />
        <p v-else class="meet-card__hint"><Link2 aria-hidden="true" />{{ t('meet.invitation') }}</p>
      </template>
      <Callout v-if="error" role="alert" :tone="joinUrl ? 'info' : 'danger'" :title="error" />
    </section>
  </main>
</template>
