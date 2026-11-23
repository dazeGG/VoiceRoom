<script setup lang="ts">
import { Separator, Toolbar, ToolbarButton } from '@voiceroom/ui-kit/components';
import { t } from '@/shared/i18n';
import { computed, ref } from 'vue';
import { Copy, Ellipsis, Reply, SmilePlus } from '@lucide/vue';
import { iconSm } from '@voiceroom/ui-kit/icon-defaults';
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
  <Toolbar
    class="message-hover-actions"
    :class="{ 'message-hover-actions--overlay-open': pickerOpen }"
    :label="t('Действия с сообщением')"
  >
    <ReactionPicker
      v-if="reactionStore && userId"
      v-model:open="pickerOpen"
      :store="reactionStore"
      :message-id="messageId"
      :user-id="userId"
      :show-quick-reactions="false"
    >
      <template #trigger="{ toggle, panelId, open }">
        <ToolbarButton
          :label="t('Открыть выбор эмодзи')"
          aria-haspopup="dialog"
          :aria-expanded="open"
          :aria-controls="panelId"
          @click="toggle"
        >
          <SmilePlus v-bind="iconSm" aria-hidden="true" />
        </ToolbarButton>
      </template>
    </ReactionPicker>
    <Separator v-if="hasReactions" orientation="vertical" />
    <ToolbarButton v-if="onReply" :label="t('Ответить')" @click="onReply">
      <Reply v-bind="iconSm" aria-hidden="true" />
    </ToolbarButton>
    <ToolbarButton :label="t('Копировать текст')" @click="emit('copy')">
      <Copy v-bind="iconSm" aria-hidden="true" />
    </ToolbarButton>
    <ToolbarButton :label="t('Больше действий')" @click="emit('more', $event)">
      <Ellipsis v-bind="iconSm" aria-hidden="true" />
    </ToolbarButton>
  </Toolbar>
</template>
