<script setup lang="ts">
import { Link, MessageSquare, UserPlus, Users } from '@lucide/vue';
import { computed } from 'vue';
import Topbar from '@/shared/components/Topbar.vue';
import { RoomInviteFriendList, RoomMenu } from '@/shared/components/room-menu';
import { Popover, PopoverDivider, PopoverMenuItem, PopoverMenuLabel } from '@/shared/ui';
import { iconMd, iconSm } from '@/shared/ui/icons';
import { copyText } from '@/shared/utils/clipboard';
import { state as roomClientState } from '../client/core/room-runtime.store';
import { getConnectionStatusView } from '../client/ui/status';
import { showToast } from '../client/ui/toast';
import { useParticipantsUiStore } from '../participants-ui.store';
import { useRoomPanelToggleStore } from '../room-panel-toggle.store';
import { usePageStore } from '@/stores/page.store';
import { useRoomSettingsStore } from '../room-settings.store';
import { useRoomUiStore } from '../room-ui.store';
import { useRoomShell } from '../shell';
import { useRoomSocial } from '../social';
import RoomCallTimer from './RoomCallTimer.vue';

const social = useRoomSocial();
const shell = useRoomShell();
const page = usePageStore();
const roomUi = useRoomUiStore();
const roomSettingsUi = useRoomSettingsStore();
const panelToggle = useRoomPanelToggleStore();
const participantsUi = useParticipantsUiStore();

const connection = computed(() => getConnectionStatusView());

// Heading content is derived from the reactive room state — the room client
// populates roomClientState.room* on join/rename.
const heading = computed(() => roomClientState.roomName || roomClientState.roomId);
const roomAccountIds = computed(
  () =>
    new Set(
      participantsUi
        .getSortedParticipants()
        .map((participant) => participant.accountUserId)
        .filter(Boolean)
    )
);
const roomUnreadCount = computed(() => panelToggle.getRoomUnreadCount());
const chatActive = computed(() => roomUi.chatOpen && roomUi.activePanel === 'chat');
const participantsActive = computed(() => roomUi.chatOpen && roomUi.activePanel === 'participants');

async function copyInviteLink(close: () => void): Promise<void> {
  try {
    await copyText(`${window.location.origin}/r/${encodeURIComponent(roomClientState.roomId)}`);
    showToast('Ссылка скопирована');
  } catch {
    showToast('Не удалось скопировать');
  }
  close();
}

function notifyRoomsChanged(): void {
  shell.roomsChanged(roomClientState.roomId);
}
</script>

<template>
  <Topbar label="Новая голосовая комната" reload>
    <div class="room-topbar__heading" aria-label="Комната" :hidden="page.screen !== 'room'">
      <div class="room-topbar__heading-main">
        <RoomMenu
          :room-id="roomClientState.roomId"
          :name="heading"
          :avatar-url="roomClientState.roomAvatarUrl"
          :avatar-size="38"
          trigger-class="room-topbar__heading-trigger"
          title-class="room-topbar__heading-title"
          chevron-class="room-topbar__heading-chevron"
          heading
          heading-class="room-topbar__heading-title-wrap"
          keep-content-mounted
          :relationship="roomSettingsUi.isOwner ? 'owner' : 'bookmarked'"
          :on-open-settings="roomSettingsUi.isOwner ? roomSettingsUi.openRoomSettings : undefined"
          :show-notification-controls="Boolean(roomClientState.self?.accountUserId)"
          @rooms-changed="notifyRoomsChanged"
          @toast="showToast"
        >
          <template v-if="roomClientState.self?.accountUserId" #inviteContent="{ close }">
            <RoomInviteFriendList
              :friends="social.friends()"
              :room-id="roomClientState.roomId"
              :present-user-ids="roomAccountIds"
              @close="close"
              @toast="showToast"
            />
          </template>
        </RoomMenu>
      </div>

      <div class="room-topbar__heading-actions">
        <RoomCallTimer />
        <Popover
          placement="bottom-end"
          role="menu"
          aria-label="Пригласить в комнату"
          panel-class="room-topbar__invite-popover"
        >
          <template #trigger="{ open, toggle, panelId }">
            <button
              class="room-topbar__invite-button"
              type="button"
              aria-haspopup="menu"
              :aria-expanded="open"
              :aria-controls="panelId"
              title="Пригласить"
              @click="toggle"
            >
              <UserPlus v-bind="iconSm" aria-hidden="true" />
              <span class="room-topbar__invite-label">Пригласить</span>
            </button>
          </template>
          <template #content="{ close }">
            <PopoverMenuItem label="Скопировать ссылку" @click="void copyInviteLink(close)">
              <template #icon><Link v-bind="iconMd" aria-hidden="true" /></template>
            </PopoverMenuItem>
            <template v-if="roomClientState.self?.accountUserId">
              <PopoverDivider />
              <PopoverMenuLabel text="Позвать друга" />
              <RoomInviteFriendList
                :friends="social.friends()"
                :room-id="roomClientState.roomId"
                :present-user-ids="roomAccountIds"
                @close="close"
                @toast="showToast"
              />
            </template>
          </template>
        </Popover>
        <div class="room-panel-tabs room-panel-tabs--topbar" role="group" aria-label="Открыть раздел панели комнаты">
          <button
            class="room-panel-tabs__tab"
            type="button"
            aria-label="Чат"
            :aria-pressed="chatActive"
            title="Чат"
            @click="panelToggle.toggleRoomPanel('chat')"
          >
            <MessageSquare v-bind="iconSm" aria-hidden="true" />
            <span v-if="roomUnreadCount > 0" class="room-panel-tabs__unread" aria-hidden="true"></span>
          </button>
          <button
            class="room-panel-tabs__tab"
            type="button"
            aria-label="Участники"
            :aria-pressed="participantsActive"
            title="Участники"
            @click="panelToggle.toggleRoomPanel('participants')"
          >
            <Users v-bind="iconSm" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>

    <div
      :class="['room-topbar__status', `room-topbar__status--${connection.stateName}`]"
      :title="connection.title || undefined"
      :hidden="connection.stateName === 'idle' || page.screen !== 'room'"
    >
      <span class="room-topbar__status-dot" aria-hidden="true"></span>
      <span>{{ connection.label }}</span>
    </div>
  </Topbar>
</template>
