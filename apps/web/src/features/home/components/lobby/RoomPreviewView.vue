<script setup lang="ts">
import { MessageSquare, MicOff, Users } from '@lucide/vue';
import { computed, reactive, ref, watch } from 'vue';
import type { AuthUser, OwnedRoom } from '@/api/auth';
import type { RealtimeEvent } from '@/api/realtime';
import type { RoomPeer } from '@/api/rooms';
import RoomMemberList from '@/entities/room/components/RoomMemberList.vue';
import { useRoomMembershipStore } from '@/entities/room/room-membership.store';
import { useRoomPresenceStore } from '@/entities/room/room-presence.store';
import { subscribeRoomPreview } from '@/entities/room/room-realtime';
import { useSessionStore } from '@/features/auth/session.store';
import RoomPanelHeader from '@/features/room/components/RoomPanelHeader.vue';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { getAvatarPresentation } from '@/shared/ui/avatar-presentation';
import { iconSm } from '@/shared/ui/icons';
import { fitTiles } from '@/shared/ui/tile-grid';
import LobbyStreamTile from './LobbyStreamTile.vue';
import RoomPreviewChat from './RoomPreviewChat.vue';
import RoomPreviewDock from './RoomPreviewDock.vue';
import RoomViewHeader from './RoomViewHeader.vue';

type Panel = 'chat' | 'participants';

const props = withDefaults(
  defineProps<{
    room: OwnedRoom;
    user: AuthUser;
    /**
     * Panel to show when this room is first previewed. A mention link opens the
     * chat straight away, without joining voice.
     */
    initialPanel?: Panel | null | undefined;
    /** Scroll the chat to this message once it opens. */
    aroundMessageId?: string | undefined;
    // A prop, not an emit: the room menu shows its settings item only when a handler is given.
    onOpenSettings?: (() => void) | undefined;
  }>(),
  { initialPanel: null, aroundMessageId: undefined, onOpenSettings: undefined }
);

const emit = defineEmits<{ enter: []; back: []; roomsChanged: []; toast: [message: string] }>();

const session = useSessionStore();
const membership = useRoomMembershipStore();
const roomPresence = useRoomPresenceStore();

const peers = ref<RoomPeer[]>([]);
const loading = ref(true);
const activePanel = ref<Panel | null>(null);
// A picture that failed to load stays hidden; a new URL gets a fresh attempt.
const failedAvatarUrls = reactive(new Set<string>());

const previewRoomId = computed(() => props.room.roomId);
const roomUnreadCount = computed(
  () => roomPresence.unreadCountByRoomId[previewRoomId.value] ?? props.room.unreadCount ?? 0
);
const screenPeers = computed(() => peers.value.filter((peer) => peer.screen));
const presentUserIds = computed(() => new Set(peers.value.map((peer) => peer.accountUserId || '').filter(Boolean)));
const tileCount = computed(() => peers.value.length + screenPeers.value.length);
const memberTotal = computed(() => membership.roomMemberTotal(previewRoomId.value, peers.value.length));

const tiles = computed(() =>
  peers.value.map((peer) => {
    const name = peerName(peer);
    return { peer, name, avatar: peerAvatar(peer, name) };
  })
);

watch(
  [previewRoomId, () => session.user?.id],
  ([id, userId]) => {
    if (userId) membership.ensureRoomMembership(id);
  },
  { immediate: true }
);

function handlePreviewEvent(event: RealtimeEvent): void {
  if (event.type === 'room.snapshot' && event.payload.roomId === props.room.roomId) {
    peers.value = event.payload.peers;
    loading.value = false;
    return;
  }
  if (event.type === 'room.peer.joined' && event.payload.roomId === props.room.roomId) {
    if (!peers.value.some((peer) => peer.id === event.payload.peer.id)) {
      peers.value = [...peers.value, event.payload.peer];
    }
    return;
  }
  if (event.type === 'room.peer.left' && event.payload.roomId === props.room.roomId) {
    peers.value = peers.value.filter((peer) => peer.id !== event.payload.peerId);
    return;
  }
  if (event.type === 'room.peer.updated' && event.payload.roomId === props.room.roomId) {
    peers.value = peers.value.map((peer) => (peer.id === event.payload.peer.id ? event.payload.peer : peer));
  }
}

watch(
  previewRoomId,
  (roomId, _previous, onCleanup) => {
    loading.value = true;
    peers.value = [];
    // Read once: the subscription belongs to the room, and a new anchor remounts
    // this view instead of resubscribing the preview for nothing.
    activePanel.value = props.initialPanel;
    onCleanup(subscribeRoomPreview(roomId, handlePreviewEvent));
  },
  { immediate: true }
);

// The tile grid sizes itself to its box; fitTiles marks a grid that overflows
// with data-scroll, which the stylesheet reads as a class.
const grid = ref<HTMLDivElement | null>(null);
const gridScrolls = ref(false);

watch(
  grid,
  (el, _previous, onCleanup) => {
    if (!el) return;
    const stopFitting = fitTiles(el);
    const mirrorScroll = (): void => {
      gridScrolls.value = el.dataset.scroll === 'true';
    };
    const observer = new MutationObserver(mirrorScroll);
    observer.observe(el, { attributes: true, attributeFilter: ['data-scroll'] });
    mirrorScroll();
    onCleanup(() => {
      observer.disconnect();
      stopFitting();
      gridScrolls.value = false;
    });
  },
  { flush: 'post' }
);

function peerName(peer: RoomPeer): string {
  return peer.name?.trim() || 'Гость';
}

function peerAvatar(peer: RoomPeer, name: string): ReturnType<typeof getAvatarPresentation> {
  return getAvatarPresentation({
    avatarAccent: peer.avatarAccent || undefined,
    avatarColorKey: peer.avatarColorKey,
    avatarUrl: peer.avatarUrl || undefined,
    isLocal: false,
    name
  });
}

function selectPanel(panel: Panel): void {
  activePanel.value = panel;
}
</script>

<template>
  <div class="room-preview">
    <div class="room-preview__top">
      <RoomViewHeader
        :room="room"
        :present-user-ids="presentUserIds"
        :on-open-settings="onOpenSettings"
        @back="emit('back')"
        @rooms-changed="emit('roomsChanged')"
        @toast="(message: string) => emit('toast', message)"
      />
      <div class="room-preview__actions">
        <div class="room-panel-tabs room-panel-tabs--topbar" role="group" aria-label="Открыть раздел панели комнаты">
          <button
            class="room-panel-tabs__tab"
            type="button"
            aria-label="Чат"
            :aria-pressed="activePanel === 'chat'"
            title="Чат"
            @click="selectPanel('chat')"
          >
            <MessageSquare v-bind="iconSm" aria-hidden="true" />
            <span v-if="roomUnreadCount > 0" class="room-panel-tabs__unread" aria-hidden="true"></span>
          </button>
          <button
            class="room-panel-tabs__tab"
            type="button"
            aria-label="Участники"
            :aria-pressed="activePanel === 'participants'"
            title="Участники"
            @click="selectPanel('participants')"
          >
            <Users v-bind="iconSm" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>

    <div class="room-preview__content">
      <div class="room-preview__stage-pane">
        <section class="stage room-preview__stage" aria-label="Участники комнаты">
          <div class="stage-strip" aria-label="Плитки комнаты">
            <div
              ref="grid"
              :class="['tile-grid', { 'tile-grid--scroll': gridScrolls, 'tile-grid--empty': tileCount === 0 }]"
            >
              <LobbyStreamTile
                v-for="peer in screenPeers"
                :key="`screen-${peer.id}`"
                :peer="peer"
                @enter="emit('enter')"
              />
              <div
                v-for="{ peer, name, avatar } in tiles"
                :key="peer.id"
                :class="[
                  'participant',
                  'room-preview__participant',
                  { 'participant--muted': peer.muted, 'participant--screen': peer.screen }
                ]"
                :data-peer-id="peer.id"
                :style="{ '--participant-pastel': avatar.background, '--participant-avatar-fg': avatar.foreground }"
              >
                <div class="participant__ring" aria-hidden="true">
                  <span class="participant__avatar"
                    >{{ avatar.initials
                    }}<img
                      v-if="avatar.src && !failedAvatarUrls.has(avatar.src)"
                      :src="avatar.src"
                      alt=""
                      @error="failedAvatarUrls.add(avatar.src)"
                  /></span>
                </div>
                <div class="participant__copy">
                  <h2 class="participant__heading">
                    <span class="participant__name"><EmojiText :text="name" /></span>
                    <span class="participant__muted-icon" aria-label="Микрофон выключен" title="Микрофон выключен">
                      <MicOff v-bind="iconSm" aria-hidden="true" />
                    </span>
                  </h2>
                  <p class="participant__status" hidden></p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div v-if="peers.length === 0 && !loading" class="room-preview__empty">
          <p class="room-preview__empty-note">Пока никого нет</p>
        </div>

        <RoomPreviewDock @enter="emit('enter')" />
      </div>

      <RoomPreviewChat
        v-if="activePanel === 'chat'"
        :key="previewRoomId"
        :room-id="previewRoomId"
        :user="user"
        :around-message-id="aroundMessageId"
        :can-moderate="room.relationship === 'owner'"
        :participant-count="memberTotal"
        @toast="(message: string) => emit('toast', message)"
        @close="activePanel = null"
        @select-participants="selectPanel('participants')"
      />
      <aside
        v-else-if="activePanel === 'participants'"
        class="room-preview__members"
        aria-label="Список участников комнаты"
      >
        <RoomPanelHeader
          active-tab="participants"
          :unread="0"
          :participant-count="memberTotal"
          :mobile="false"
          @select-chat="selectPanel('chat')"
          @collapse="activePanel = null"
        />
        <div class="room-preview__members-body"><RoomMemberList :room-id="previewRoomId" /></div>
      </aside>
    </div>
  </div>
</template>
