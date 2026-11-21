<script setup lang="ts">
import { computed } from 'vue';
import { Tabs, type TabOption } from '@voice-room/ui/components';
import { t } from '@/shared/i18n';
import { PanelRightClose, X } from '@lucide/vue';
import { iconSm } from '@/shared/ui/icons';

const props = withDefaults(
  defineProps<{
    activeTab: 'chat' | 'participants';
    unread: number;
    /** People in the room, shown beside «Участники». */
    participantCount?: number | undefined;
    /** On a phone the panel is the whole screen, so it closes instead of collapsing. */
    mobile: boolean;
    chatTabId?: string | undefined;
    participantsTabId?: string | undefined;
    chatPanelId?: string | undefined;
    participantsPanelId?: string | undefined;
  }>(),
  {
    participantCount: 0,
    chatTabId: undefined,
    participantsTabId: undefined,
    chatPanelId: undefined,
    participantsPanelId: undefined
  }
);

const emit = defineEmits<{
  selectChat: [];
  selectParticipants: [];
  collapse: [];
}>();

const items = computed<TabOption<'chat' | 'participants'>[]>(() => [
  { value: 'chat', label: t('Чат'), dot: props.unread > 0, id: props.chatTabId, panelId: props.chatPanelId },
  {
    value: 'participants',
    label: t('Участники'),
    ...(props.participantCount > 0 && { count: props.participantCount }),
    id: props.participantsTabId,
    panelId: props.participantsPanelId
  }
]);

function select(tab: string): void {
  if (tab === 'chat') emit('selectChat');
  if (tab === 'participants') emit('selectParticipants');
}
</script>

<template>
  <header class="room-panel-header">
    <Tabs
      class="room-panel-header__tabs"
      :items="items"
      :model-value="activeTab"
      :label="t('Раздел панели комнаты')"
      variant="segmented"
      stretch
      @update:model-value="select"
    />
    <button
      class="room-panel-header__collapse"
      type="button"
      :aria-label="mobile ? t('Закрыть панель') : t('Свернуть панель')"
      @click="emit('collapse')"
    >
      <X v-if="mobile" v-bind="iconSm" aria-hidden="true" />
      <PanelRightClose v-else v-bind="iconSm" aria-hidden="true" />
    </button>
  </header>
</template>
