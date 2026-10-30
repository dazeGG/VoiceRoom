<script setup lang="ts">
// Collapsed strip above the chat body. Collapsed it is just a count; expanded
// it lists the pinned messages newest-first, each jumping to the message.
import { computed } from 'vue';
import { ChevronDown, Pin, X } from '@lucide/vue';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { iconSm } from '@/shared/ui/icons';
import { useRoomPinsStore } from '../pins.store';

const props = withDefaults(defineProps<{ canUnpin?: boolean }>(), { canUnpin: false });

const emit = defineEmits<{
  jump: [messageId: string];
  unpin: [messageId: string];
}>();

const roomPins = useRoomPinsStore();
const count = computed(() => roomPins.pins.length);
const expanded = computed(() => roomPins.expanded);

function preview(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 90 ? `${clean.slice(0, 89)}…` : clean || 'Вложение';
}
</script>

<template>
  <div v-if="count > 0" class="pinned-bar" :class="{ 'pinned-bar--expanded': expanded }">
    <button
      class="pinned-bar__toggle"
      type="button"
      :aria-expanded="expanded"
      @click="roomPins.expanded = !roomPins.expanded"
    >
      <span class="pinned-bar__icon" aria-hidden="true"><Pin v-bind="iconSm" /></span>
      <span class="pinned-bar__title">Закреплённые</span>
      <span class="pinned-bar__count">{{ count }}</span>
      <span class="pinned-bar__chevron" aria-hidden="true"><ChevronDown v-bind="iconSm" /></span>
    </button>

    <ul v-if="expanded" class="pinned-bar__list">
      <li v-for="pin in roomPins.pins" :key="pin.messageId" class="pinned-bar__item">
        <button class="pinned-bar__jump" type="button" @click="emit('jump', pin.messageId)">
          <span class="pinned-bar__author"><EmojiText :text="pin.author.name || 'Участник'" /></span>
          <span class="pinned-bar__text">{{ preview(pin.text) }}</span>
        </button>
        <button
          v-if="props.canUnpin"
          class="pinned-bar__unpin"
          type="button"
          aria-label="Открепить сообщение"
          title="Открепить"
          @click="emit('unpin', pin.messageId)"
        >
          <X v-bind="iconSm" aria-hidden="true" />
        </button>
      </li>
    </ul>
  </div>
</template>
