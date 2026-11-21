<script setup lang="ts">
import { Badge } from '@voice-room/ui/components';
import { t } from '@/shared/i18n';
import { Link, MessageSquare, UserPlus, Users } from '@lucide/vue';
import { computed } from 'vue';
import { useSessionStore } from '@/features/auth/session.store';
import Topbar from '@/shared/components/Topbar.vue';
import { RoomInviteFriendList, RoomMenu } from '@/shared/components/room-menu';
import { DropdownMenu, MenuSeparator, MenuItem, MenuLabel } from '@/shared/ui';
import { iconMd, iconSm } from '@/shared/ui/icons';
import { copyText } from '@/shared/utils/clipboard';
import { state as roomClientState } from '@voice-room/call/engine/core/room-runtime.store';
import { getConnectionStatusView } from '@voice-room/call/engine/ui/status';
import { showToast } from '@voice-room/call/engine/ui/toast';
import { useParticipantsUiStore } from '@voice-room/call/engine/core/participants-ui.store';
import { useRoomPanelToggleStore } from '../room-panel-toggle.store';
import { useCallPageStore } from '@voice-room/call/engine/core/call-page.store';
import { useRoomSettingsStore } from '../room-settings.store';
import { useRoomUiStore } from '../room-ui.store';
import { useRoomShell } from '../shell';
import { useRoomSocial } from '../social';
import RoomCallTimer from './RoomCallTimer.vue';

defineProps<{ languageInSettings?: boolean }>();

const social = useRoomSocial();
const session = useSessionStore();
const shell = useRoomShell();
const page = useCallPageStore();
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
    showToast(t('Ссылка скопирована'));
  } catch {
    showToast(t('Не удалось скопировать'));
  }
  close();
}

function notifyRoomsChanged(): void {
  shell.roomsChanged(roomClientState.roomId);
}
</script>

<template>
  <Topbar
    :label="t('Новая голосовая комната')"
    reload
    :show-language="!languageInSettings && session.loaded && !session.user"
  >
    <div class="room-topbar__heading" :aria-label="t('Комната')" :hidden="page.screen !== 'room'">
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
        <DropdownMenu :aria-label="t('Пригласить в комнату')">
          <template #trigger>
            <button class="room-topbar__invite-button" type="button" :title="t('Пригласить')">
              <UserPlus v-bind="iconSm" aria-hidden="true" />
              <span class="room-topbar__invite-label">{{ t('Пригласить') }}</span>
            </button>
          </template>
          <template #content="{ close }">
            <MenuItem :label="t('Скопировать ссылку')" @select.prevent="void copyInviteLink(close)">
              <template #icon><Link v-bind="iconMd" aria-hidden="true" /></template>
            </MenuItem>
            <template v-if="roomClientState.self?.accountUserId">
              <MenuSeparator />
              <MenuLabel :text="t('Позвать друга')" />
              <RoomInviteFriendList
                :friends="social.friends()"
                :room-id="roomClientState.roomId"
                :present-user-ids="roomAccountIds"
                @close="close"
                @toast="showToast"
              />
            </template>
          </template>
        </DropdownMenu>
        <div
          class="room-panel-tabs room-panel-tabs--topbar"
          role="group"
          :aria-label="t('Открыть раздел панели комнаты')"
        >
          <button
            class="room-panel-tabs__tab"
            type="button"
            :aria-label="t('Чат')"
            :aria-pressed="chatActive"
            :title="t('Чат')"
            @click="panelToggle.toggleRoomPanel('chat')"
          >
            <MessageSquare v-bind="iconSm" aria-hidden="true" />
            <Badge v-if="roomUnreadCount > 0" class="room-panel-tabs__unread" aria-hidden="true" variant="dot" ring />
          </button>
          <button
            class="room-panel-tabs__tab"
            type="button"
            :aria-label="t('Участники')"
            :aria-pressed="participantsActive"
            :title="t('Участники')"
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
