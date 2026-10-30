<script setup lang="ts">
import { computed } from 'vue';
import EmojiText from './EmojiText.vue';
import type { ReplyTarget } from './reply-store';

const props = withDefaults(
  defineProps<{
    preview: ReplyTarget;
    interactive?: boolean | undefined;
  }>(),
  { interactive: false }
);

const emit = defineEmits<{ jump: [messageId: string] }>();

const author = computed(() => props.preview.author?.name || (props.preview.deleted ? '' : 'Сообщение'));
const text = computed(() => (props.preview.deleted ? 'Сообщение недоступно' : props.preview.text || 'Вложение'));

function jump(): void {
  if (!props.interactive || props.preview.deleted) return;
  emit('jump', props.preview.messageId);
}
</script>

<template>
  <button
    v-if="interactive && !preview.deleted"
    class="reply-preview reply-preview--interactive"
    type="button"
    :aria-label="`Перейти к сообщению${author ? ` от ${author}` : ''}`"
    @click="jump"
  >
    <strong v-if="author"><EmojiText :text="author" /></strong>
    <span><EmojiText :text="text" /></span>
  </button>
  <div
    v-else
    class="reply-preview"
    :class="{ 'reply-preview--tombstone': preview.deleted }"
    aria-label="Ответ на сообщение"
  >
    <strong v-if="author"><EmojiText :text="author" /></strong>
    <span><EmojiText :text="text" /></span>
  </div>
</template>
