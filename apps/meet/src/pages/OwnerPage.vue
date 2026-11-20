<script setup lang="ts">
import { ArrowRight, Check, Copy, Link2, Video } from '@lucide/vue';
import { t } from '@voice-room/ui/i18n';
import { ref, useTemplateRef } from 'vue';
import { MeetApiError } from '@/adapters/meet-api';
import { useMeetStore } from '@/meet.store';

const meet = useMeetStore();
const creating = ref(false);
const joinUrl = ref('');
const copied = ref(false);
const error = ref('');
const linkInput = useTemplateRef<HTMLInputElement>('link');

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
    linkInput.value?.focus();
    linkInput.value?.select();
    error.value = t('meet.copyManually');
  }
}
</script>

<template>
  <main class="meet-entry">
    <section class="meet-card" :aria-busy="creating || meet.owner === 'checking'">
      <div class="meet-card__icon"><Video :size="26" aria-hidden="true" /></div>
      <template v-if="joinUrl">
        <h1>{{ t('meet.created') }}</h1>
        <p>{{ t('meet.shareDescription') }}</p>
        <div class="meet-card__fields">
          <label class="meet-card__label" for="meeting-link">{{ t('meet.meetingLink') }}</label>
          <input id="meeting-link" ref="link" class="meet-card__input" type="url" :value="joinUrl" readonly />
          <button class="meet-button" type="button" @click="copyLink">
            <Check v-if="copied" :size="18" aria-hidden="true" />
            <Copy v-else :size="18" aria-hidden="true" />
            {{ t(copied ? 'meet.copied' : 'meet.copyLink') }}
          </button>
          <a class="meet-button meet-button--secondary" :href="joinUrl">
            {{ t('meet.openMeeting') }} <ArrowRight :size="18" aria-hidden="true" />
          </a>
        </div>
        <span v-if="copied" class="meet-shell__sr-only" role="status">{{ t('meet.copied') }}</span>
      </template>
      <template v-else-if="meet.owner === 'ready'">
        <h1>{{ t('meet.createTitle') }}</h1>
        <p>{{ t('meet.createDescription') }}</p>
        <button class="meet-button" type="button" :disabled="creating" @click="createMeeting">
          {{ t(creating ? 'meet.creating' : 'meet.create') }} <ArrowRight :size="18" aria-hidden="true" />
        </button>
      </template>
      <template v-else>
        <h1>VoiceRoom Meet</h1>
        <p v-if="meet.owner === 'checking'" role="status">{{ t('meet.checkingOwner') }}</p>
        <p v-else-if="meet.owner === 'rejected'" role="alert">{{ t('meet.error.ownerLink') }}</p>
        <p v-else class="meet-card__hint"><Link2 :size="18" aria-hidden="true" />{{ t('meet.invitation') }}</p>
      </template>
      <p v-if="error" class="meet-card__error" role="alert">{{ error }}</p>
    </section>
  </main>
</template>
