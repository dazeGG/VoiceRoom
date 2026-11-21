<script setup lang="ts">
import { Tag, Popover, TagCount } from '@voiceroom/ui-kit/components';
import { t } from '@/shared/i18n';
import { computed } from 'vue';
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
    :aria-label="t('Реакции на сообщение')"
  >
    <Tag
      v-for="summary in summaries"
      :key="summary.emoji"
      variant="reaction"
      size="sm"
      :selectable="canMutate"
      :disabled="summary.pending"
      :pressed="summary.reactedByMe"
      :label="t('{p0} реакцию {p1}', { p0: summary.reactedByMe ? t('Убрать') : t('Добавить'), p1: summary.emoji })"
      @update:pressed="void store.toggle(messageId, summary.emoji)"
    >
      <template #emoji><Emoji :emoji="summary.emoji" :size="18" decorative /></template>
      <template #count>
        <Popover
          placement="top-start"
          flip
          role="dialog"
          :aria-label="t('Пользователи с реакцией {p0}', { p0: summary.emoji })"
        >
          <template #trigger="{ open, toggle, panelId }">
            <TagCount
              :count="summary.count"
              :label="t('Показать пользователей: {p0}', { p0: summary.count })"
              aria-haspopup="dialog"
              :aria-expanded="open"
              :aria-controls="panelId"
              @click="toggle"
            />
          </template>
          <template #content="{ close }">
            <ReactorList :store="store" :message-id="messageId" :emoji="summary.emoji" @close="close()" />
          </template>
        </Popover>
        <span v-if="summary.error" class="reaction-summary__error" role="alert">{{ summary.error }}</span>
      </template>
    </Tag>
  </div>
</template>
