<script setup lang="ts">
import { Info, Send, X } from '@lucide/vue';
import { MEET_CHAT_MAX_BYTES } from '@voice-room/shared/contracts/realtime';
import { t } from '@voice-room/ui/i18n';
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import type { MeetTransport } from '@/adapters/meet-transport';

const props = defineProps<{ panelId: string; localPeerId: string; chat: MeetTransport['chat'] }>();
const open = defineModel<boolean>({ required: true });
const { messages, ready, error, send } = props.chat;
const draft = ref('');
const compact = ref(false);
const dialog = useTemplateRef<HTMLDialogElement>('dialog');
const log = useTemplateRef<HTMLDivElement>('log');
const input = useTemplateRef<HTMLInputElement>('input');
const titleId = `${props.panelId}-title`;
const noticeId = `${props.panelId}-notice`;
const inputId = `${props.panelId}-input`;
const statusId = `${props.panelId}-status`;
const encoder = new TextEncoder();
const trimmed = computed(() => draft.value.trim());
const tooLong = computed(() => encoder.encode(trimmed.value).byteLength > MEET_CHAT_MAX_BYTES);
const status = computed(() => {
  if (tooLong.value) return t('meet.chat.tooLong');
  if (!ready.value) return t('meet.chat.offline');
  if (error.value === 'rate_limited') return t('meet.chat.rateLimited');
  return error.value ? t('meet.chat.sendFailed') : '';
});

let followMessages = true;
let viewport: MediaQueryList | undefined;

function updateViewport(): void {
  compact.value = viewport?.matches ?? false;
}

onMounted(() => {
  viewport = window.matchMedia('(max-width: 760px)');
  updateViewport();
  viewport.addEventListener('change', updateViewport);
});
onBeforeUnmount(() => viewport?.removeEventListener('change', updateViewport));

function scrollToLatest(): void {
  if (log.value) log.value.scrollTop = log.value.scrollHeight;
}

function updateScroll(): void {
  const element = log.value;
  if (element) followMessages = element.scrollHeight - element.clientHeight - element.scrollTop <= 24;
}

watch(
  [open, compact],
  ([visible, mobile]) => {
    const panel = dialog.value;
    if (!panel) return;
    if (!visible || (panel.open && panel.matches(':modal') !== mobile)) panel.close();
    if (!visible || panel.open) return;
    if (mobile) panel.showModal();
    else panel.show();
    followMessages = true;
    scrollToLatest();
  },
  { flush: 'post' }
);

watch(
  () => messages.value.at(-1)?.id,
  () => {
    if (followMessages && open.value) scrollToLatest();
  },
  { flush: 'post' }
);

function onClose(): void {
  if (!dialog.value?.open) open.value = false;
}

function closeDesktop(): void {
  if (!compact.value) open.value = false;
}

function submit(): void {
  if (!ready.value || !trimmed.value || tooLong.value || !send(trimmed.value)) return;
  draft.value = '';
  followMessages = true;
  input.value?.focus();
}
</script>

<template>
  <dialog
    :id="panelId"
    ref="dialog"
    class="meet-chat"
    :aria-labelledby="titleId"
    :aria-describedby="noticeId"
    @close="onClose"
    @keydown.esc="closeDesktop"
  >
    <header class="meet-chat__header">
      <h2 :id="titleId">{{ t('meet.chat.title') }}</h2>
      <button
        class="meet-button meet-button--secondary meet-chat__close"
        type="button"
        :aria-label="t('meet.chat.close')"
        autofocus
        @click="open = false"
      >
        <X :size="19" aria-hidden="true" />
      </button>
    </header>
    <p :id="noticeId" class="meet-chat__notice">
      <Info :size="17" aria-hidden="true" />
      {{ t('meet.chat.notice') }}
    </p>
    <div
      ref="log"
      class="meet-chat__log"
      role="log"
      :aria-label="t('meet.chat.messages')"
      tabindex="0"
      @scroll.passive="updateScroll"
    >
      <p v-if="!messages.length" class="meet-chat__empty">{{ t('meet.chat.empty') }}</p>
      <ol v-else class="meet-chat__messages" role="list">
        <li
          v-for="message in messages"
          :key="message.id"
          class="meet-chat__message"
          :class="{ 'meet-chat__message--own': message.authorId === localPeerId }"
        >
          <span class="meet-chat__author">{{ message.displayName }}</span>
          <p>{{ message.text }}</p>
        </li>
      </ol>
    </div>
    <form class="meet-chat__composer" method="post" @submit.prevent="submit">
      <div class="meet-chat__field">
        <label :for="inputId">{{ t('meet.chat.input') }}</label>
        <div class="meet-chat__controls">
          <input
            :id="inputId"
            ref="input"
            v-model="draft"
            type="text"
            name="message"
            autocomplete="off"
            enterkeyhint="send"
            :maxlength="MEET_CHAT_MAX_BYTES"
            :aria-invalid="tooLong"
            :aria-describedby="status ? statusId : undefined"
          />
          <button
            class="meet-button meet-chat__send"
            type="submit"
            :aria-label="t('meet.chat.send')"
            :disabled="!ready || !trimmed || tooLong"
          >
            <Send :size="18" aria-hidden="true" />
          </button>
        </div>
      </div>
      <p :id="statusId" class="meet-chat__status" role="status">{{ status }}</p>
    </form>
  </dialog>
</template>
