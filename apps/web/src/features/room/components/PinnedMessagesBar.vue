<script setup lang="ts">
import { IconButton, Pressable } from '@voice-room/ui/components';
// Collapsed strip above the chat body. Collapsed it is just a count; expanded
// it lists the pinned messages newest-first, each jumping to the message.
import { t } from '@/shared/i18n';
import { computed } from 'vue';
import { ChevronDown, Pin, X } from '@lucide/vue';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { iconSm } from '@voice-room/ui/icon-defaults';
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
  return clean.length > 90 ? `${clean.slice(0, 89)}…` : clean || t('Вложение');
}
</script>

<template>
  <div v-if="count > 0" class="pinned-bar" :class="{ 'pinned-bar--expanded': expanded }">
    <Pressable class="pinned-bar__toggle" :aria-expanded="expanded" @click="roomPins.expanded = !roomPins.expanded">
      <span class="pinned-bar__icon" aria-hidden="true"><Pin v-bind="iconSm" /></span>
      <span class="pinned-bar__title">{{ t('Закреплённые') }}</span>
      <span class="pinned-bar__count">{{ count }}</span>
      <span class="pinned-bar__chevron" aria-hidden="true"><ChevronDown v-bind="iconSm" /></span>
    </Pressable>

    <ul v-if="expanded" class="pinned-bar__list">
      <li v-for="pin in roomPins.pins" :key="pin.messageId" class="pinned-bar__item">
        <Pressable class="pinned-bar__jump" @click="emit('jump', pin.messageId)">
          <span class="pinned-bar__author"><EmojiText :text="pin.author.name || t('Участник')" /></span>
          <span class="pinned-bar__text">{{ preview(pin.text) }}</span>
        </Pressable>
        <IconButton
          v-if="props.canUnpin"
          :label="t('Открепить сообщение')"
          :size="28"
          variant="danger"
          @click="emit('unpin', pin.messageId)"
        >
          <X aria-hidden="true" />
        </IconButton>
      </li>
    </ul>
  </div>
</template>
