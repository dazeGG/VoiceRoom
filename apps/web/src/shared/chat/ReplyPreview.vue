<script setup lang="ts">
import { Pressable } from '@voiceroom/ui-kit/components';
import { t } from '@/shared/i18n';
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

const author = computed(() => props.preview.author?.name || (props.preview.deleted ? '' : t('Сообщение')));
const text = computed(() => (props.preview.deleted ? t('Сообщение недоступно') : props.preview.text || t('Вложение')));

function jump(): void {
  if (!props.interactive || props.preview.deleted) return;
  emit('jump', props.preview.messageId);
}
</script>

<template>
  <Pressable
    v-if="interactive && !preview.deleted"
    class="reply-preview reply-preview--interactive"
    :aria-label="t('Перейти к сообщению{p0}', { p0: author ? t(' от {p0}', { p0: String(author) }) : '' })"
    @click="jump"
  >
    <strong v-if="author"><EmojiText :text="author" /></strong>
    <span><EmojiText :text="text" /></span>
  </Pressable>
  <div
    v-else
    class="reply-preview"
    :class="{ 'reply-preview--tombstone': preview.deleted }"
    :aria-label="t('Ответ на сообщение')"
  >
    <strong v-if="author"><EmojiText :text="author" /></strong>
    <span><EmojiText :text="text" /></span>
  </div>
</template>
