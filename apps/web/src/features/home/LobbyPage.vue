<script setup lang="ts">
import { Badge, Splitter, type SplitterWidth } from '@voice-room/ui/components';
import { PanelLeftClose, PanelLeftOpen } from '@lucide/vue';
import { t } from '@/shared/i18n';
import type { InboxItem } from '@voice-room/shared/contracts/notifications';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watchEffect } from 'vue';
import type { AuthUser, OwnedRoom } from '@/api/auth';
import { getAppRealtime } from '@/api/realtime';
import { createRoom } from '@/api/rooms';
import { useProfileCardUiStore } from '@/entities/profile-card/profile-card-ui.store';
import { clientRoomName } from '@voice-room/call/engine';
import { provideRoomShell } from '@/features/room/shell';
import { provideRoomSocial } from '@/features/room/social';
import { useRoomUiStore } from '@/features/room/room-ui.store';
import { useScreenUiStore } from '@voice-room/call/engine';
import { useVoiceSessionStore } from '@voice-room/call/engine';
import RoomPage from '@/features/room/RoomPage.vue';
import { useSessionStore } from '@/features/auth/session.store';
import { usePageStore } from '@/stores/page.store';
import { useNotificationPreferencesStore } from '@/shared/notifications/preferences.store';
import { effectivePresenceStatus } from '@/shared/presence';
import { Avatar } from '@/shared/ui';
import { displayNameOf } from '@/shared/utils/display-name';
import { extractRoomId } from '@/shared/utils/room';
import CreateRoomDialog from './components/CreateRoomDialog.vue';
import LobbyAccountDialogs from './components/LobbyAccountDialogs.vue';
import NotificationInbox from './components/NotificationInbox.vue';
import OpenInAppScreen from './components/OpenInAppScreen.vue';
import RoomSwitchDialog from './components/RoomSwitchDialog.vue';
import DmView from './components/lobby/DmView.vue';
import LobbyRoomSettingsDialog from './components/lobby/LobbyRoomSettingsDialog.vue';
import PeopleView from './components/lobby/PeopleView.vue';
import RoomBrowseView from './components/lobby/RoomBrowseView.vue';
import RoomPreviewView from './components/lobby/RoomPreviewView.vue';
import Sidebar from './components/lobby/Sidebar.vue';
import VoiceHome from './components/lobby/VoiceHome.vue';
import { ProfileCardHost } from './components/profile-card';
import type { ActiveVoice } from './model/active-voice';
import { syncLobbyWithDesktop } from './model/desktop-sync';
import { syncEmbeddedRoomDocument } from './model/embedded-room-document';
import type { FriendMenuTarget } from './model/friend-menu';
import { provideLobby } from './model/lobby-context';
import { useLobbyStore } from './model/lobby.store';
import { useAccountPrompts } from './model/use-account-prompts';
import { useLobbyNotifications } from './model/use-lobby-notifications';
import { useLobbyRooms } from './model/use-lobby-rooms';
import { useLobbyRouting } from './model/use-lobby-routing';
import { useLobbySidebar } from './model/use-lobby-sidebar';
import { useStaffAccess } from './model/use-staff-access';
import { useRoomNavigationStore } from './model/room-navigation.store';
import { roomDisplayName } from './model/rooms';
import type { ToastOptions } from './model/toasts.store';

const lobby = useLobbyStore();
lobby.configure({ onEnterRoom: (roomId) => routing.requestEnterRoom(roomId) });
provideLobby(lobby);

// Rooms shown inside the lobby see the account's friends through this.
provideRoomSocial(lobby.roomSocial);

const props = withDefaults(
  defineProps<{
    user: AuthUser;
    loggingOut: boolean;
    /** The account was just made for a permanent room: open the new-room dialog. */
    createRoomOnOpen?: boolean;
  }>(),
  { createRoomOnOpen: false }
);

const emit = defineEmits<{
  logout: [];
  toast: [message: string, options?: ToastOptions];
}>();

function toast(...args: [message: string, options?: ToastOptions]): void {
  emit('toast', ...args);
}

const session = useSessionStore();
const navigation = useRoomNavigationStore();
const voiceSession = useVoiceSessionStore();
const roomUi = useRoomUiStore();
const screenUi = useScreenUiStore();
const page = usePageStore();

const rooms = useLobbyRooms((message) => toast(message));
const routing = useLobbyRouting(lobby, rooms);
const staff = useStaffAccess(toast);
const notifications = useLobbyNotifications();
const preferences = useNotificationPreferencesStore();
const { list: roomList } = rooms;
const { pendingRoomSwitchId, openInAppRoomId, previewAnchor } = routing;
const { adminUrl, openReports } = staff;
const { open: notificationsOpen } = notifications;
const { profileCardUi } = useProfileCardUiStore();
const friendMenu = shallowRef<FriendMenuTarget | null>(null);
const sidebar = useLobbySidebar(() =>
  Boolean(friendMenu.value || (profileCardUi.open && profileCardUi.restoreFocus?.closest('#lobby-sidebar')))
);
const {
  visible: sidebarVisible,
  collapsed: sidebarLayoutCollapsed,
  peeking: sidebarPeeking,
  width: sidebarWidth,
  maxWidth: sidebarMaxWidth,
  dragging: sidebarDragging,
  dragWidth
} = sidebar;
const sidebarToggleLabel = computed(() =>
  sidebarLayoutCollapsed.value ? t('Развернуть боковую панель') : t('Свернуть боковую панель')
);
const sidebarToggle = useTemplateRef<HTMLButtonElement>('sidebarToggle');
const sidebarHandleId = 'lobby-sidebar-resize';
function commitSidebar(layout: SplitterWidth): void {
  if (layout.collapsed && document.activeElement?.id === sidebarHandleId) {
    sidebarToggle.value?.focus();
  }
  sidebar.commit(layout);
}

// What the room shown in the lobby tells it.
provideRoomShell({
  roomLeft: (roomId) => routing.closeLeftRoom(roomId),
  roomsChanged: () => void rooms.refresh()
});

const roomLabel = (roomId: string): string => rooms.label(roomId);
const creating = ref(false);
const createDialogOpen = ref(false);
const previewSettingsRoomId = ref('');
const selectedRoomId = computed(() => navigation.viewedRoomId);
const embeddedRoomId = computed(() => navigation.mountedRoomId());
const autoJoinRoomId = computed(() => navigation.joinIntentRoomId);
const connectedVoiceRoomId = computed(() => navigation.getActiveVoiceRoomId());

const prompts = useAccountPrompts({
  user: () => props.user,
  voiceActive: () => Boolean(connectedVoiceRoomId.value || navigation.joinIntentRoomId),
  lobbyDialogOpen: () => createDialogOpen.value,
  onToast: (message, options) => toast(message, options)
});
const { recoveryCodesReminder } = prompts;

const selectedRoom = computed(() => rooms.find(selectedRoomId.value));
const previewSettingsRoom = computed(() => rooms.find(previewSettingsRoomId.value));
const connectedVoiceRoom = computed(() => rooms.find(connectedVoiceRoomId.value));
// A room the list does not have (a temporary one, or one not kept yet) is
// named by the room client that is connected to it.
const connectedVoiceRoomName = computed(() =>
  connectedVoiceRoom.value
    ? roomDisplayName(connectedVoiceRoom.value)
    : clientRoomName(connectedVoiceRoomId.value) || connectedVoiceRoomId.value || ''
);
const activeVoice = computed<ActiveVoice | null>(() =>
  connectedVoiceRoomId.value
    ? {
        roomName: connectedVoiceRoomName.value.trim() || connectedVoiceRoomId.value,
        avatarUrl: connectedVoiceRoom.value?.avatarUrl ?? null,
        muted: voiceSession.muted,
        deafened: voiceSession.deafened,
        open: routing.openConnectedVoiceRoom,
        toggleMic: voiceSession.toggleActiveVoiceMic,
        toggleDeafen: voiceSession.toggleActiveVoiceDeafen,
        leave: () => void routing.leaveConnectedVoiceRoom()
      }
    : null
);
const sortedFriends = computed(() =>
  [...lobby.friends].sort((a, b) => (b.lastMessage?.createdAt ?? 0) - (a.lastMessage?.createdAt ?? 0))
);
const notificationUsers = computed(() => sortedFriends.value.map((entry) => entry.user));
const sidebarFriends = computed(() =>
  sortedFriends.value.map(({ user, online, unreadCount }) => ({
    user,
    unreadCount,
    presence: effectivePresenceStatus(online, user.presenceStatus, user.doNotDisturb),
    muted: preferences.notificationPreferences.mutedPeerIds.includes(user.id)
  }))
);
const embeddedRoomVisible = computed(() => navigation.embeddedRoomIsVisible(lobby.mode));
const previewAnchorOfSelected = computed(() =>
  selectedRoom.value && previewAnchor.value?.roomId === selectedRoom.value.roomId ? previewAnchor.value : null
);

// The server closes the realtime socket with a dedicated code when this
// device's session was ended elsewhere (another device, password recovery).
let stopSessionEnded: (() => void) | undefined;
let teardown: (() => void) | undefined;

onMounted(() => {
  stopSessionEnded = getAppRealtime().onSessionEnded(() => {
    // Our own sign-out or password change already handles the UI.
    if (session.consumeExpectedSessionEnd() || !session.user) return;
    session.clearSession();
    toast(t('Сеанс на этом устройстве завершён. Войдите снова'));
  });

  void rooms.refresh();
  if (props.createRoomOnOpen) createDialogOpen.value = true;
  prompts.start();
  const teardownNotifications = notifications.start();
  const teardownFriends = lobby.init(props.user.id, props.user.doNotDisturb, props.user.presenceStatus);
  const teardownRooms = rooms.follow();
  const teardownStaff = staff.start();
  const teardownRouting = routing.start();
  teardown = () => {
    teardownNotifications();
    teardownFriends();
    teardownRooms();
    teardownStaff();
    teardownRouting();
  };
});

onBeforeUnmount(() => {
  stopSessionEnded?.();
  teardown?.();
});

watchEffect(() => {
  if (!embeddedRoomId.value) {
    page.lobbyEmbedded = false;
    return;
  }
  syncEmbeddedRoomDocument({
    visible: embeddedRoomVisible.value,
    chatOpen: roomUi.chatOpen,
    streamOnStage: screenUi.stageVisible
  });
});

syncLobbyWithDesktop({
  get userId() {
    return props.user.id;
  },
  get voiceRoomId() {
    return connectedVoiceRoomId.value || '';
  },
  get voiceRoomName() {
    return connectedVoiceRoomName.value;
  },
  get friends() {
    return lobby.friends;
  },
  get rooms() {
    return roomList.value;
  },
  onDisconnect: () => void routing.leaveConnectedVoiceRoom()
});

function handleJoin(code: string): void {
  const roomId = extractRoomId(code);
  if (!roomId) {
    toast(t('Введите код комнаты'));
    return;
  }
  routing.requestEnterRoom(roomId);
}

async function handleCreate(payload: { name: string; isStatic: boolean }): Promise<void> {
  if (creating.value) return;
  creating.value = true;
  try {
    const roomId = await createRoom(payload);
    createDialogOpen.value = false;
    routing.requestEnterRoom(roomId);
    if (payload.isStatic) void rooms.refresh();
    toast(t('Комната создана'));
  } catch (error) {
    toast(error instanceof Error && error.message ? error.message : t('Не удалось создать комнату'));
  } finally {
    creating.value = false;
  }
}

function openPeople(): void {
  lobby.mode = 'friends';
  lobby.showPeople();
}

function openNotification(item: InboxItem): void {
  notificationsOpen.value = false;
  routing.openRoomMessage(item.roomId, item.sourceMessageId);
}

function openSettingsOf(room: OwnedRoom): (() => void) | undefined {
  return room.relationship === 'owner' ? () => (previewSettingsRoomId.value = room.roomId) : undefined;
}

function closeViewedRoomAndRefresh(): void {
  routing.closeViewedRoom();
  void rooms.refresh();
}

function roomDeleted(): void {
  previewSettingsRoomId.value = '';
  routing.closeViewedRoom();
  void rooms.refresh();
}
</script>

<template>
  <Splitter
    v-model:collapsed="sidebarLayoutCollapsed"
    class="lobby-shell"
    :class="{
      'lobby-shell--sidebar-collapsed': sidebarLayoutCollapsed,
      'lobby-shell--sidebar-peeking': sidebarPeeking,
      'lobby-shell--resizing': sidebarDragging
    }"
    :style="{ '--lv-side-w': `${dragWidth ?? sidebarWidth}px` }"
    :width="sidebarWidth"
    :min-width="sidebar.minWidth"
    :max-width="sidebarMaxWidth"
    :collapsed-width="48"
    :handle-id="sidebarHandleId"
    :label="t('Ширина боковой панели')"
    @dragging="sidebar.setDragging"
    @resize="sidebar.resize"
    @commit="commitSidebar"
  >
    <template #side>
      <div class="lobby-shell__sidebar" @pointerenter="sidebar.showPreview" @pointerleave="sidebar.hidePreview">
        <div v-if="sidebarLayoutCollapsed" class="lobby-shell__sidebar-rail" aria-hidden="true">
          <span class="sidebar__brand-mark"></span>
          <div class="lobby-shell__sidebar-avatars">
            <div v-for="friend in sidebarFriends" :key="friend.user.id" class="lobby-shell__sidebar-avatar">
              <Avatar
                :name="displayNameOf(friend.user)"
                :src="friend.user.avatarUrl"
                :color-key="friend.user.avatarColorKey"
                :background="friend.user.avatarAccent || undefined"
                :online="friend.presence === 'online'"
                :afk="friend.presence === 'away'"
                :dnd="friend.presence === 'dnd'"
                :size="30"
                show-dot
                ring="var(--vr-surface)"
              />
              <Badge
                v-if="friend.unreadCount > 0"
                class="lobby-shell__sidebar-unread"
                :tone="friend.muted ? 'muted' : 'accent'"
                :count="friend.unreadCount"
                size="sm"
                ring
              />
            </div>
          </div>
          <div class="lobby-shell__sidebar-account">
            <Avatar
              :name="displayNameOf(user)"
              :src="user.avatarUrl"
              :color-key="user.avatarColorKey"
              :background="user.avatarAccent || undefined"
              :size="32"
            />
          </div>
        </div>
        <button
          ref="sidebarToggle"
          class="sidebar__icon-button lobby-shell__sidebar-toggle"
          type="button"
          aria-controls="lobby-sidebar"
          :aria-expanded="sidebarVisible"
          :aria-label="sidebarToggleLabel"
          :title="sidebarToggleLabel"
          @click="sidebar.toggle"
        >
          <PanelLeftClose v-if="!sidebarLayoutCollapsed" :size="16" aria-hidden="true" />
          <PanelLeftOpen v-else :size="16" aria-hidden="true" />
        </button>
        <Transition name="lobby-sidebar-peek" :css="sidebarLayoutCollapsed && !sidebarDragging">
          <Sidebar
            v-show="sidebarVisible"
            id="lobby-sidebar"
            v-model:friend-menu="friendMenu"
            :aria-hidden="!sidebarVisible"
            :inert="!sidebarVisible"
            :user="user"
            :admin-url="adminUrl"
            :admin-badge="openReports"
            :notifications-open="notificationsOpen"
            :notification-unread-count="notifications.inbox.unreadCount"
            :active-voice="activeVoice"
            @go-home="routing.goHome"
            @open-people="openPeople"
            @open-settings="prompts.openSettings"
            @open-notifications="notifications.toggle"
            @toast="(message: string) => toast(message)"
          />
        </Transition>
      </div>
    </template>

    <main class="lobby-shell__main" :aria-label="t('Главная VoiceRoom')">
      <div v-if="embeddedRoomId" class="lobby-shell__room" :hidden="!embeddedRoomVisible">
        <RoomPage
          :key="embeddedRoomId"
          :embedded-room-id="embeddedRoomId"
          :auto-join="autoJoinRoomId === embeddedRoomId"
        />
      </div>

      <RoomBrowseView
        v-if="
          lobby.mode === 'rooms' && selectedRoom && connectedVoiceRoomId && selectedRoom.roomId !== connectedVoiceRoomId
        "
        :user="user"
        :room="selectedRoom"
        :on-open-settings="openSettingsOf(selectedRoom)"
        @enter="routing.requestEnterRoom(selectedRoom.roomId)"
        @back="routing.closeViewedRoom"
        @rooms-changed="closeViewedRoomAndRefresh"
        @toast="(message: string) => toast(message)"
      />
      <!-- Keyed on the anchor so a second mention in a room already on screen
           still reopens its chat on the new message. -->
      <RoomPreviewView
        v-else-if="lobby.mode === 'rooms' && selectedRoom && (!embeddedRoomId || !embeddedRoomVisible)"
        :key="previewAnchorOfSelected?.messageId ?? ''"
        :user="user"
        :room="selectedRoom"
        :initial-panel="previewAnchorOfSelected ? 'chat' : null"
        :around-message-id="previewAnchorOfSelected?.messageId"
        :on-open-settings="openSettingsOf(selectedRoom)"
        @enter="routing.requestEnterRoom(selectedRoom.roomId)"
        @back="routing.closeViewedRoom"
        @rooms-changed="closeViewedRoomAndRefresh"
        @toast="(message: string) => toast(message)"
      />
      <DmView v-else-if="lobby.mode === 'friends' && lobby.view === 'dm'" :self="user" />
      <PeopleView
        v-else-if="lobby.mode === 'friends' && lobby.view === 'people'"
        :user="user"
        @toast="(message: string) => toast(message)"
        @home="routing.goHome"
      />
      <VoiceHome
        v-else-if="(lobby.mode === 'rooms' && !embeddedRoomVisible) || lobby.mode === 'friends'"
        :rooms="roomList"
        :recovery-codes-reminder="recoveryCodesReminder"
        @open-room="routing.previewRoom"
        @create-room="createDialogOpen = true"
        @join-code="handleJoin"
        @rooms-changed="rooms.refresh"
        @open-room-settings="(roomId: string) => (previewSettingsRoomId = roomId)"
        @open-recovery-codes="prompts.openSecuritySettings('recovery-codes')"
        @snooze-recovery-codes="prompts.snoozeRecoveryCodes"
        @toast="(message: string) => toast(message)"
      />
    </main>
    <aside v-if="notificationsOpen" class="lobby-shell__inbox" :aria-label="t('Панель уведомлений')">
      <NotificationInbox
        :inbox="notifications.inbox"
        :room-label="roomLabel"
        :on-close="() => (notificationsOpen = false)"
        @open="openNotification"
      />
    </aside>
  </Splitter>

  <CreateRoomDialog
    :open="createDialogOpen"
    :creating="creating"
    @close="createDialogOpen = false"
    @create="handleCreate"
  />
  <LobbyAccountDialogs
    :prompts="prompts"
    :user="user"
    :notification-users="notificationUsers"
    :notification-rooms="roomList"
    :logging-out="loggingOut"
    @toast="toast"
    @logout="emit('logout')"
  />
  <LobbyRoomSettingsDialog
    :room="previewSettingsRoom"
    @close="previewSettingsRoomId = ''"
    @saved="rooms.refresh"
    @deleted="roomDeleted"
    @toast="toast"
  />
  <RoomSwitchDialog
    :open="Boolean(pendingRoomSwitchId)"
    :from-name="connectedVoiceRoomName"
    :to-name="rooms.label(pendingRoomSwitchId)"
    @confirm="(dontAskAgain: boolean) => routing.resolveRoomSwitch(true, dontAskAgain)"
    @cancel="routing.resolveRoomSwitch(false)"
  />
  <ProfileCardHost @toast="(message: string) => toast(message)" />
  <OpenInAppScreen v-if="openInAppRoomId" @retry="routing.openRoomInApp" @continue="routing.continueRoomInBrowser" />
</template>
