<script setup lang="ts">
import { computed } from 'vue';
import { Popover } from '@/shared/ui';
import ReactorList from './ReactorList.vue';
import Emoji from './Emoji.vue';
import type { ReactionStore } from './reaction-store';

const props = withDefaults(
  defineProps<{
    store: ReactionStore;
    messageId: string;
    canMutate?: boolean;
  }>(),
  { canMutate: true }
);

const summaries = computed(() => props.store.forMessage(props.messageId));
</script>

<template>
  <div
    v-if="summaries.length > 0 && !store.isDeleted(messageId)"
    class="reaction-summary"
    aria-label="Реакции на сообщение"
  >
    <div
      v-for="summary in summaries"
      :key="summary.emoji"
      class="reaction-summary__chip"
      :class="{
        'reaction-summary__chip--reacted': summary.reactedByMe,
        'reaction-summary__chip--pending': summary.pending
      }"
    >
      <button
        v-if="canMutate"
        class="reaction-summary__toggle"
        type="button"
        :disabled="summary.pending"
        :aria-pressed="summary.reactedByMe"
        :aria-label="`${summary.reactedByMe ? 'Убрать' : 'Добавить'} реакцию ${summary.emoji}`"
        @click="void store.toggle(messageId, summary.emoji)"
      >
        <Emoji :emoji="summary.emoji" :size="18" decorative />
      </button>
      <span v-else class="reaction-summary__toggle" aria-hidden="true">
        <Emoji :emoji="summary.emoji" :size="18" decorative />
      </span>
      <Popover placement="top-start" flip role="dialog" :aria-label="`Пользователи с реакцией ${summary.emoji}`">
        <template #trigger="{ open, toggle, panelId }">
          <button
            class="reaction-summary__count"
            type="button"
            :aria-label="`Показать пользователей: ${summary.count}`"
            aria-haspopup="dialog"
            :aria-expanded="open"
            :aria-controls="panelId"
            @click="toggle"
          >
            {{ summary.count }}
          </button>
        </template>
        <template #content="{ close }">
          <ReactorList :store="store" :message-id="messageId" :emoji="summary.emoji" @close="close()" />
        </template>
      </Popover>
      <span v-if="summary.error" class="reaction-summary__error" role="alert">{{ summary.error }}</span>
    </div>
  </div>
</template>
