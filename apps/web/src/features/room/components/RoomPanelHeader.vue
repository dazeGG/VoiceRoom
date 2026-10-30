<script setup lang="ts">
import { PanelRightClose, X } from '@lucide/vue';
import { iconSm } from '@/shared/ui/icons';

withDefaults(
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
</script>

<template>
  <header class="room-panel-header">
    <div class="room-panel-tabs room-panel-tabs--header" role="tablist" aria-label="Раздел панели комнаты">
      <button
        :id="chatTabId"
        class="room-panel-tabs__tab"
        type="button"
        role="tab"
        :aria-controls="chatPanelId"
        aria-label="Чат"
        :aria-selected="activeTab === 'chat'"
        title="Чат"
        @click="emit('selectChat')"
      >
        <span>Чат</span>
        <span v-if="unread > 0" class="room-panel-tabs__unread" aria-hidden="true"></span>
      </button>
      <button
        :id="participantsTabId"
        class="room-panel-tabs__tab"
        type="button"
        role="tab"
        :aria-controls="participantsPanelId"
        aria-label="Участники"
        :aria-selected="activeTab === 'participants'"
        title="Участники"
        @click="emit('selectParticipants')"
      >
        <span>Участники</span>
        <span v-if="participantCount > 0" class="room-panel-tabs__count" aria-hidden="true">{{
          participantCount
        }}</span>
      </button>
    </div>
    <button
      class="room-panel-header__collapse"
      type="button"
      :aria-label="mobile ? 'Закрыть панель' : 'Свернуть панель'"
      @click="emit('collapse')"
    >
      <X v-if="mobile" v-bind="iconSm" aria-hidden="true" />
      <PanelRightClose v-else v-bind="iconSm" aria-hidden="true" />
    </button>
  </header>
</template>
