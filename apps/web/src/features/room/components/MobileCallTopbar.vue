<script setup lang="ts">
import { LayoutGrid, MessageSquare, Users } from '@lucide/vue';
import { computed } from 'vue';
import { isRecord } from '@voice-room/shared/guards';
import { state as roomClientState } from '@/features/room/client/core/room-runtime.store';
import { showToast } from '@/features/room/client/ui/toast';
import { useMobileCallUiStore } from '@/features/room/mobile-call-ui.store';
import { useParticipantsUiStore } from '@/features/room/participants-ui.store';
import { useRoomPanelToggleStore } from '@/features/room/room-panel-toggle.store';
import { useVoiceSessionStore } from '@/features/room/voice-session.store';
import { Avatar } from '@/shared/ui';
import { copyText } from '@/shared/utils/clipboard';
import RoomCallTimer from './RoomCallTimer.vue';

defineProps<{ duo: boolean }>();

const mobileCall = useMobileCallUiStore();
const participantsUi = useParticipantsUiStore();
const panels = useRoomPanelToggleStore();
const voiceSession = useVoiceSessionStore();

const heading = computed(() => roomClientState.roomName || roomClientState.roomId);
const unread = computed(() => panels.getRoomUnreadCount());
const viewLabel = computed(() => (mobileCall.view === 'grid' ? 'Фокус на говорящем' : 'Сетка'));

// A phone shares the room through its own sheet (messengers, AirDrop); where
// there is none the link goes to the clipboard.
async function invite(): Promise<void> {
  const url = `${window.location.origin}/r/${encodeURIComponent(roomClientState.roomId)}`;
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: heading.value, url });
      return;
    } catch (error) {
      // Closing the sheet is a choice, not a failure.
      if (isRecord(error) && error.name === 'AbortError') return;
    }
  }
  try {
    await copyText(url);
    showToast('Ссылка скопирована');
  } catch {
    showToast('Не удалось скопировать');
  }
}

function handleInviteClick(): void {
  void invite();
}
</script>

<template>
  <header :class="['mobile-call-topbar', { 'mobile-call-topbar--duo': duo }]">
    <button
      class="mobile-call-topbar__room"
      type="button"
      :aria-label="`Пригласить в «${heading}»`"
      @click="handleInviteClick"
    >
      <Avatar
        :name="heading"
        :src="roomClientState.roomAvatarUrl || null"
        shape="squircle"
        background="var(--vr-surface-3)"
        :size="36"
      />
      <span class="mobile-call-topbar__copy">
        <span class="mobile-call-topbar__title">{{ heading }}</span>
        <span class="mobile-call-topbar__meta">
          <RoomCallTimer />
          <span v-if="voiceSession.roomActiveSince" class="mobile-call-topbar__dot" aria-hidden="true">·</span>
          <span>{{ participantsUi.getParticipantCount() }} в звонке</span>
        </span>
      </span>
    </button>
    <div class="room-panel-tabs mobile-call-topbar__actions" role="group" aria-label="Звонок">
      <button
        v-if="!duo"
        type="button"
        class="room-panel-tabs__tab mobile-call-topbar__view"
        :aria-label="viewLabel"
        :title="viewLabel"
        @click="mobileCall.toggleMobileCallView"
      >
        <!-- One big frame over three small ones: the focus layout. -->
        <svg
          v-if="mobileCall.view === 'grid'"
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          aria-hidden="true"
        >
          <rect x="1.5" y="1.5" width="15" height="9.5" rx="2" stroke="currentColor" stroke-width="1.6" />
          <rect x="1.5" y="13" width="4" height="3.5" rx="1" fill="currentColor" />
          <rect x="7" y="13" width="4" height="3.5" rx="1" fill="currentColor" />
          <rect x="12.5" y="13" width="4" height="3.5" rx="1" fill="currentColor" />
        </svg>
        <LayoutGrid v-else :size="18" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="room-panel-tabs__tab"
        aria-label="Чат"
        :aria-pressed="panels.isRoomPanelOpen('chat')"
        @click="panels.toggleRoomPanel('chat')"
      >
        <MessageSquare :size="18" aria-hidden="true" />
        <span v-if="unread > 0" class="room-panel-tabs__unread" aria-hidden="true"></span>
      </button>
      <button
        type="button"
        class="room-panel-tabs__tab"
        aria-label="Участники"
        :aria-pressed="panels.isRoomPanelOpen('participants')"
        @click="panels.toggleRoomPanel('participants')"
      >
        <Users :size="18" aria-hidden="true" />
      </button>
    </div>
  </header>
</template>
