<script setup lang="ts" generic="Payload">
// The messages of an outbox at the foot of a chat: dimmed while on their
// way, and with their error and a way to send again or drop when they fail.
import { t } from '@/shared/i18n';
import type { Outgoing } from './outbox';

withDefaults(
  defineProps<{
    items: Outgoing<Payload>[];
    textOf: (payload: Payload) => string;
    attachmentsOf?: (payload: Payload) => number;
  }>(),
  { attachmentsOf: () => 0 }
);

const emit = defineEmits<{ retry: [localId: string]; discard: [localId: string] }>();
</script>

<template>
  <ol v-if="items.length" class="outgoing-messages" :aria-label="t('Неотправленные сообщения')">
    <li
      v-for="item in items"
      :key="item.localId"
      class="outgoing-messages__item"
      :class="{ 'outgoing-messages__item--failed': item.state === 'failed' }"
      :data-outgoing-id="item.localId"
    >
      <div class="outgoing-messages__bubble">
        <p v-if="textOf(item.payload)" class="outgoing-messages__text">{{ textOf(item.payload) }}</p>
        <p v-if="attachmentsOf(item.payload)" class="outgoing-messages__meta">
          {{ t('Изображений:') }} {{ attachmentsOf(item.payload) }}
        </p>
      </div>
      <div v-if="item.state === 'failed'" class="outgoing-messages__status" role="alert">
        <span>{{ t('Не отправлено:') }} {{ item.error }}</span>
        <button type="button" @click="emit('retry', item.localId)">{{ t('Повторить') }}</button>
        <button type="button" @click="emit('discard', item.localId)">{{ t('Удалить') }}</button>
      </div>
      <div v-else class="outgoing-messages__status" role="status">{{ t('Отправляется…') }}</div>
    </li>
  </ol>
</template>
