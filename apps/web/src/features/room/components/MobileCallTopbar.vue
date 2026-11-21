<script setup lang="ts">
import { IconButton, Badge, Avatar, Pressable, ControlGroup } from '@voiceroom/ui-kit/components';
import { t } from '@/shared/i18n';
import { LayoutGrid, MessageSquare, Users } from '@lucide/vue';
import { computed } from 'vue';
import { isRecord } from '@voiceroom/shared/guards';
import { state as roomClientState } from '@voiceroom/call/engine/core/room-runtime.store';
import { showToast } from '@voiceroom/call/engine/ui/toast';
import { useMobileCallUiStore } from '@/features/room/mobile-call-ui.store';
import { useParticipantsUiStore } from '@voiceroom/call/engine/core/participants-ui.store';
import { useRoomPanelToggleStore } from '@/features/room/room-panel-toggle.store';
import { useVoiceSessionStore } from '@voiceroom/call/engine/core/voice-session.store';
import { copyText } from '@/shared/utils/clipboard';
import RoomCallTimer from './RoomCallTimer.vue';

defineProps<{ duo: boolean }>();

const mobileCall = useMobileCallUiStore();
const participantsUi = useParticipantsUiStore();
const panels = useRoomPanelToggleStore();
const voiceSession = useVoiceSessionStore();

const heading = computed(() => roomClientState.roomName || roomClientState.roomId);
const unread = computed(() => panels.getRoomUnreadCount());
const viewLabel = computed(() => (mobileCall.view === 'grid' ? t('Фокус на говорящем') : t('Сетка')));

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
    showToast(t('Ссылка скопирована'));
  } catch {
    showToast(t('Не удалось скопировать'));
  }
}

function handleInviteClick(): void {
  void invite();
}
</script>

<template>
  <header :class="['mobile-call-topbar', { 'mobile-call-topbar--duo': duo }]">
    <Pressable
      class="mobile-call-topbar__room"
      :aria-label="t('Пригласить в «{p0}»', { p0: heading })"
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
          <span>{{ participantsUi.getParticipantCount() }} {{ t('в звонке') }}</span>
        </span>
      </span>
    </Pressable>
    <ControlGroup class="room-panel-switches mobile-call-topbar__actions" :label="t('Звонок')">
      <IconButton
        v-if="!duo"
        class="room-panel-switches__button mobile-call-topbar__view"
        :label="viewLabel"
        :size="44"
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
        <LayoutGrid v-else aria-hidden="true" />
      </IconButton>
      <IconButton
        class="room-panel-switches__button"
        :label="t('Чат')"
        :aria-pressed="panels.isRoomPanelOpen('chat')"
        :size="44"
        @click="panels.toggleRoomPanel('chat')"
      >
        <MessageSquare aria-hidden="true" />
        <Badge v-if="unread > 0" class="room-panel-switches__unread" aria-hidden="true" variant="dot" ring />
      </IconButton>
      <IconButton
        class="room-panel-switches__button"
        :label="t('Участники')"
        :aria-pressed="panels.isRoomPanelOpen('participants')"
        :size="44"
        @click="panels.toggleRoomPanel('participants')"
      >
        <Users aria-hidden="true" />
      </IconButton>
    </ControlGroup>
  </header>
</template>
