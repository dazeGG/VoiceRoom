<script setup lang="ts">
import { IconButton, Popover } from '@voiceroom/ui-kit/components';
import { t } from '@/shared/i18n';
import { ref, watch } from 'vue';
import { SmilePlus } from '@lucide/vue';
import Emoji from './Emoji.vue';
import EmojiPickerPanel from './EmojiPickerPanel.vue';
import type { ReactionStore } from './reaction-store';
import { DEFAULT_FREQUENT_REACTIONS, loadFrequentReactions, recordFrequentReaction } from './frequent-reactions';

const PERSISTENCE_NAMESPACE = 'chat';

const props = withDefaults(
  defineProps<{
    store: ReactionStore;
    messageId: string;
    userId: string;
    disabled?: boolean;
    /** Off inside the hover toolbar, which has no room for three more buttons. */
    showQuickReactions?: boolean;
  }>(),
  { disabled: false, showQuickReactions: true }
);

defineSlots<{ trigger?(state: { toggle: () => void; panelId: string | undefined; open: boolean }): unknown }>();

/** Bindable so a host toolbar can stay visible while the panel is open. */
const open = defineModel<boolean>('open', { default: false });

const frequentEmoji = ref<string[]>([...DEFAULT_FREQUENT_REACTIONS]);

watch(
  () => props.userId,
  (activeUserId, _previous, onCleanup) => {
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    void loadFrequentReactions(PERSISTENCE_NAMESPACE, activeUserId).then((emoji) => {
      if (!cancelled && props.userId === activeUserId) frequentEmoji.value = emoji;
    });
  },
  { immediate: true }
);

async function react(emoji: string): Promise<void> {
  const wasReacted = props.store
    .forMessage(props.messageId)
    .some((summary) => summary.emoji === emoji && summary.reactedByMe);
  if (!(await props.store.toggle(props.messageId, emoji))) return;
  if (!wasReacted) {
    frequentEmoji.value = await recordFrequentReaction(PERSISTENCE_NAMESPACE, props.userId, emoji);
  }
}

async function choose(emoji: string, close: () => void): Promise<void> {
  await react(emoji);
  close();
}
</script>

<template>
  <div v-if="!store.isDeleted(messageId)" class="reaction-picker" role="group" :aria-label="t('Быстрые реакции')">
    <template v-if="showQuickReactions">
      <IconButton
        v-for="emoji in frequentEmoji"
        :key="emoji"
        class="reaction-picker__button"
        :disabled="disabled"
        :label="t('Добавить быструю реакцию {p0}', { p0: emoji })"
        :size="32"
        @click="void react(emoji)"
      >
        <Emoji :emoji="emoji" :size="20" decorative />
      </IconButton>
    </template>
    <Popover
      v-model:open="open"
      placement="top-start"
      flip
      floating
      inset="flush"
      role="dialog"
      :aria-label="t('Выбор реакции')"
      panel-class="reaction-picker-panel"
    >
      <template #trigger="{ toggle, panelId }">
        <slot name="trigger" :toggle="toggle" :panel-id="panelId" :open="open">
          <IconButton
            class="reaction-picker__button reaction-picker__button--more"
            :disabled="disabled"
            :label="t('Открыть выбор эмодзи')"
            aria-haspopup="dialog"
            :aria-expanded="open"
            :aria-controls="panelId"
            :size="32"
            @click="toggle"
          >
            <SmilePlus aria-hidden="true" />
          </IconButton>
        </slot>
      </template>

      <template #content="{ close }">
        <EmojiPickerPanel :frequent-emoji="frequentEmoji" @pick="(emoji: string) => void choose(emoji, close)" />
      </template>
    </Popover>
  </div>
</template>
