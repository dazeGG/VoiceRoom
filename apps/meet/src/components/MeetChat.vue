<script setup lang="ts">
import { Send } from '@lucide/vue';
import { MEET_CHAT_MAX_BYTES } from '@voice-room/shared/contracts/realtime';
import { Dialog, EmptyState, Field, IconButton, Textarea } from '@voice-room/ui/components';
import { t } from '@voice-room/ui/i18n';
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import type { MeetTransport } from '@/adapters/meet-transport';

const props = defineProps<{ panelId: string; localPeerId: string; chat: MeetTransport['chat'] }>();
const open = defineModel<boolean>({ required: true });
const { messages, ready, error, send } = props.chat;
const draft = ref('');
const compact = ref(false);
const log = useTemplateRef<HTMLDivElement>('log');
const input = useTemplateRef<{ textarea: HTMLTextAreaElement | null }>('input');
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
let compositionEndedAt = -Infinity;

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
  log,
  (element) => {
    if (!element) return;
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
  open.value = false;
}

function submit(): void {
  if (!ready.value || !trimmed.value || tooLong.value || !send(trimmed.value)) return;
  draft.value = '';
  followMessages = true;
  input.value?.textarea?.focus();
}

function submitOnEnter(event: KeyboardEvent): void {
  if (event.shiftKey) return;
  event.preventDefault();
  // Safari can deliver compositionend before the Enter that confirmed the IME candidate.
  if (event.isComposing || Math.abs(event.timeStamp - compositionEndedAt) < 50) return;
  submit();
}
</script>

<template>
  <Dialog
    :id="panelId"
    :open="open"
    :modal="compact"
    layout="panel"
    :title="t('meet.chat.title')"
    :description="t('meet.chat.notice')"
    :close-label="t('meet.chat.close')"
    :on-close="onClose"
  >
    <div class="meet-chat">
      <div
        ref="log"
        class="meet-chat__log"
        role="log"
        :aria-label="t('meet.chat.messages')"
        tabindex="0"
        @scroll.passive="updateScroll"
      >
        <EmptyState v-if="!messages.length" :title="t('meet.chat.empty')" compact />
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
        <Field :id="inputId" :label="t('meet.chat.input')">
          <div class="meet-chat__controls">
            <Textarea
              ref="input"
              v-model="draft"
              variant="compact"
              name="message"
              autocomplete="off"
              rows="1"
              enterkeyhint="send"
              :maxlength="MEET_CHAT_MAX_BYTES"
              :show-count="false"
              :aria-invalid="tooLong"
              :aria-describedby="status ? statusId : undefined"
              @compositionend="compositionEndedAt = $event.timeStamp"
              @keydown.enter="submitOnEnter"
            />
            <IconButton
              type="submit"
              variant="primary"
              :size="44"
              :label="t('meet.chat.send')"
              :disabled="!ready || !trimmed || tooLong"
            >
              <Send aria-hidden="true" />
            </IconButton>
          </div>
        </Field>
        <p :id="statusId" class="meet-chat__status" role="status">{{ status }}</p>
      </form>
    </div>
  </Dialog>
</template>
