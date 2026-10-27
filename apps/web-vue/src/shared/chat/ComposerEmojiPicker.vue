<script setup lang="ts">
import { Smile } from '@lucide/vue';
import { onBeforeUnmount, ref, watch } from 'vue';
import { Popover } from '@/shared/ui';
import type { PopoverContentState, PopoverTriggerState } from '@/shared/ui';
import { iconSm } from '@/shared/ui/icons';
import EmojiPickerPanel from './EmojiPickerPanel.vue';
import { DEFAULT_FREQUENT_REACTIONS, loadFrequentReactions, recordFrequentReaction } from './frequent-reactions';
import { TYPING_NOTICE_INTERVAL_MS } from './typing';

// Shares the frequent list with reactions: the same few emoji tend to be the
// ones someone both reacts with and writes.
const PERSISTENCE_NAMESPACE = 'chat';

const { userId = '', disabled } = defineProps<{
  /** Empty for a guest, whose frequent list is the default and is not kept. */
  userId?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  pick: [emoji: string];
  /** Called on open and then regularly while the panel stays open. */
  browse: [];
}>();

const open = ref(false);
const frequentEmoji = ref<string[]>([...DEFAULT_FREQUENT_REACTIONS]);

watch(
  () => userId,
  (activeUserId, _previous, onCleanup) => {
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    void loadFrequentReactions(PERSISTENCE_NAMESPACE, activeUserId).then((emoji) => {
      if (!cancelled && userId === activeUserId) frequentEmoji.value = emoji;
    });
  },
  { immediate: true }
);

// Browsing is repeated at half the notice interval so the host's notifier,
// which throttles to the full interval, never skips a beat and lets the
// "выбирает эмодзи" state lapse while the panel is still open.
let browseTimer: ReturnType<typeof setInterval> | undefined;

function stopBrowsing(): void {
  clearInterval(browseTimer);
  browseTimer = undefined;
}

watch(
  open,
  (isOpen) => {
    stopBrowsing();
    if (!isOpen) return;
    emit('browse');
    browseTimer = setInterval(() => emit('browse'), TYPING_NOTICE_INTERVAL_MS / 2);
  },
  { immediate: true }
);

onBeforeUnmount(stopBrowsing);

function choose(emoji: string, close: (restoreFocus?: boolean) => void): void {
  // Focus goes back to the composer, not to this button.
  close(false);
  emit('pick', emoji);
  if (userId) {
    void recordFrequentReaction(PERSISTENCE_NAMESPACE, userId, emoji).then((ranked) => {
      frequentEmoji.value = ranked;
    });
  }
}
</script>

<template>
  <Popover
    v-model:open="open"
    placement="top-end"
    flip
    floating
    role="dialog"
    aria-label="Выбор эмодзи"
    root-class="composer-emoji-picker"
    panel-class="reaction-picker-panel"
  >
    <template #trigger="{ toggle, panelId }: PopoverTriggerState">
      <button
        class="composer-emoji-picker__trigger"
        type="button"
        :disabled="disabled"
        aria-label="Добавить эмодзи"
        title="Эмодзи"
        aria-haspopup="dialog"
        :aria-expanded="open"
        :aria-controls="panelId"
        @click="toggle"
      >
        <Smile v-bind="iconSm" aria-hidden="true" />
      </button>
    </template>

    <template #content="{ close }: PopoverContentState">
      <EmojiPickerPanel
        :frequent-emoji="frequentEmoji"
        search-label="Поиск эмодзи"
        sections-label="Разделы эмодзи"
        grid-label="Эмодзи"
        :option-label="(emoji: string) => `Эмодзи ${emoji}`"
        tone-strip-label="Цвет кожи для этого эмодзи"
        @pick="(emoji: string) => choose(emoji, close)"
      />
    </template>
  </Popover>
</template>
