<script setup lang="ts">
// The in-room rail: it owns the room-shell wiring (peer session, panel state,
// participant menu) and renders the shared room chat panel for everything the
// lobby preview also shows.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoomMembershipStore } from '@/entities/room/room-membership.store';
import RoomMemberList from '@/entities/room/components/RoomMemberList.vue';
import { useSessionStore } from '@/features/auth/session.store';
import { cleanDisplayName } from '@/shared/utils/text';
import { DISPLAY_NAME_STORAGE_KEY, readStorage } from '@/shared/storage';
import { usePageStore } from '@/stores/page.store';
import { getRoomIdFromPath, getStoredPeerSession } from '../client/core/session';
import { showToast } from '../client/ui/toast';
import { useParticipantContextUiStore } from '../participant-context-ui.store';
import { useParticipantsUiStore } from '../participants-ui.store';
import { useRoomSettingsStore } from '../room-settings.store';
import { useRoomUiStore } from '../room-ui.store';
import RoomChatPanel from './RoomChatPanel.vue';

const roomUi = useRoomUiStore();
const roomSettings = useRoomSettingsStore();
const participantsUi = useParticipantsUiStore();
const membership = useRoomMembershipStore();
const sessionStore = useSessionStore();
const page = usePageStore();
const { openParticipantContextMenu } = useParticipantContextUiStore();

const roomId = ref('');
const peerId = ref('');
const sessionToken = ref('');
const ready = ref(false);

onMounted(() => {
  roomId.value = getRoomIdFromPath();
  const peerSession = getStoredPeerSession(roomId.value);
  peerId.value = peerSession.peerId;
  sessionToken.value = peerSession.sessionToken;
  ready.value = true;
});

watch(
  [roomId, () => sessionStore.user?.id],
  ([id, userId]) => {
    if (id && userId) membership.ensureRoomMembership(id);
  },
  { immediate: true }
);

// Reflect chat state onto <body> (through the page store) so the room layout + dock can react in CSS.
watch(
  () => roomUi.chatOpen,
  (open) => {
    page.chatOpen = open;
  },
  { immediate: true }
);
onBeforeUnmount(() => {
  page.chatOpen = false;
});

// Read at send time: the guest name dialog can persist a name long after this
// component mounted.
function resolveDisplayName(): string {
  return cleanDisplayName(readStorage(DISPLAY_NAME_STORAGE_KEY)) || 'Гость';
}

function openAuthorMenu(authorPeerId: string, event: MouseEvent): void {
  const anchor = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  const rect = anchor?.getBoundingClientRect();
  queueMicrotask(() =>
    openParticipantContextMenu(
      authorPeerId,
      rect ? rect.left + rect.width / 2 : event.clientX,
      rect ? rect.bottom + 6 : event.clientY,
      'list',
      anchor
    )
  );
}
</script>

<template>
  <RoomChatPanel
    v-if="ready"
    :room-id="roomId"
    :peer-id="peerId"
    :session-token="sessionToken"
    :resolve-display-name="resolveDisplayName"
    root-class="room-chat-rail"
    aria-label="Панель комнаты"
    :hidden="!roomUi.chatOpen"
    :active-tab="roomUi.activePanel === 'participants' ? 'participants' : 'chat'"
    :visible="roomUi.chatOpen"
    :unread="roomUi.unreadChat"
    :participant-count="membership.roomMemberTotal(roomId, participantsUi.getParticipantCount())"
    chat-tab-id="room-panel-chat-tab"
    participants-tab-id="room-panel-participants-tab"
    chat-panel-id="room-panel-chat"
    participants-panel-id="room-panel-participants"
    :on-author-context-menu="openAuthorMenu"
    :can-moderate="roomSettings.isOwner"
    @select-chat="roomUi.selectRoomPanel('chat')"
    @select-participants="roomUi.selectRoomPanel('participants')"
    @collapse="roomUi.closeChat()"
    @read="roomUi.markChatRead()"
    @unread-message="roomUi.incrementUnreadChat()"
    @toast="showToast"
  >
    <template #participants>
      <RoomMemberList :room-id="roomId" />
    </template>
  </RoomChatPanel>
</template>
