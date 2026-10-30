<script setup lang="ts">
import { computed, ref } from 'vue';
import { Copy, Ellipsis, Reply } from '@lucide/vue';
import { iconSm } from '@/shared/ui/icons';
import ReactionPicker from './ReactionPicker.vue';
import type { ReactionStore } from './reaction-store';

const props = withDefaults(
  defineProps<{
    reactionStore?: ReactionStore | undefined;
    messageId: string;
    userId?: string | undefined;
    /** Offers «Ответить» when given. */
    onReply?: (() => void) | undefined;
  }>(),
  { reactionStore: undefined, userId: undefined, onReply: undefined }
);

const emit = defineEmits<{ copy: []; more: [event: MouseEvent] }>();

const hasReactions = computed(() => Boolean(props.reactionStore && props.userId));
// An open picker moves the pointer and the focus into its panel, which would
// drop the row's :hover and take this toolbar with it.
const pickerOpen = ref(false);
</script>

<template>
  <div
    class="message-hover-actions"
    :class="{ 'message-hover-actions--overlay-open': pickerOpen }"
    role="toolbar"
    aria-label="Действия с сообщением"
  >
    <ReactionPicker
      v-if="reactionStore && userId"
      v-model:open="pickerOpen"
      :store="reactionStore"
      :message-id="messageId"
      :user-id="userId"
      :show-quick-reactions="false"
    />
    <span
      v-if="hasReactions"
      class="message-hover-actions__divider"
      role="separator"
      aria-orientation="vertical"
    ></span>
    <button
      v-if="onReply"
      class="message-hover-actions__button"
      type="button"
      aria-label="Ответить"
      title="Ответить"
      @click="onReply"
    >
      <Reply v-bind="iconSm" aria-hidden="true" />
    </button>
    <button
      class="message-hover-actions__button"
      type="button"
      aria-label="Копировать текст"
      title="Копировать текст"
      @click="emit('copy')"
    >
      <Copy v-bind="iconSm" aria-hidden="true" />
    </button>
    <button
      class="message-hover-actions__button"
      type="button"
      aria-label="Больше действий"
      title="Больше действий"
      @click="emit('more', $event)"
    >
      <Ellipsis v-bind="iconSm" aria-hidden="true" />
    </button>
  </div>
</template>
