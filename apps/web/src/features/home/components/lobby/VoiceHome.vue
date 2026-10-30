<script setup lang="ts">
import { BellOff, Plus, ShieldCheck, UserPlus, X } from '@lucide/vue';
import { computed, ref, shallowRef } from 'vue';
import type { OwnedRoom } from '@/api/auth';
import { useRoomPresenceStore } from '@/entities/room/room-presence.store';
import { RoomMenuContent } from '@/shared/components/room-menu';
import { useNotificationPreferencesStore } from '@/shared/notifications/preferences.store';
import { Avatar, AvatarStack, Badge, Button, ContextMenu, Ellipsis } from '@/shared/ui';
import { iconMd, iconSm } from '@/shared/ui/icons';
import { roomPeerAvatarItems } from '../../model/room-avatars';
import { roomDisplayName } from '../../model/rooms';
import { useLobby } from '../../model/lobby-context';

const lobby = useLobby();
const roomPresence = useRoomPresenceStore();
const { notificationPreferences } = useNotificationPreferencesStore();

const props = withDefaults(
  defineProps<{
    rooms: OwnedRoom[];
    recoveryCodesReminder?: boolean;
  }>(),
  { recoveryCodesReminder: false }
);

const emit = defineEmits<{
  openRoom: [roomId: string];
  createRoom: [];
  joinCode: [code: string];
  roomsChanged: [];
  openRoomSettings: [roomId: string];
  openRecoveryCodes: [];
  snoozeRecoveryCodes: [];
  toast: [message: string];
}>();

const joinCode = ref('');
const contextRoomId = ref('');
const contextX = ref(0);
const contextY = ref(0);
const contextTrigger = shallowRef<HTMLElement | null>(null);
// The request banner can be hidden until another request arrives. Kept by id:
// a count would miss a new request that came in as an old one was answered.
const dismissedRequestIds = ref<ReadonlySet<string>>(new Set());
// When the request list did not load, the friends answer's count stands in;
// hiding then lasts until that count changes.
const dismissedRequestCount = ref<number | null>(null);

const requestCount = computed(() => lobby.incomingRequestCount);
const showRequestBanner = computed(() =>
  lobby.requests.incoming.length > 0
    ? lobby.requests.incoming.some((request) => !dismissedRequestIds.value.has(request.id))
    : requestCount.value > 0 && requestCount.value !== dismissedRequestCount.value
);
const sortedRooms = computed(() => [...props.rooms].sort((a: OwnedRoom, b: OwnedRoom) => b.peers - a.peers));
const liveRooms = computed(() => sortedRooms.value.filter((room: OwnedRoom) => room.peers > 0));
const quietRooms = computed(() => sortedRooms.value.filter((room: OwnedRoom) => room.peers === 0));
const contextRoom = computed(() => props.rooms.find((room: OwnedRoom) => room.roomId === contextRoomId.value));

function roomAvatars(roomId: string) {
  return roomPeerAvatarItems(roomPresence.peersByRoomId[roomId] || []);
}

// Friends already in the room render disabled in the invite submenu.
function roomPresentUserIds(roomId: string): Set<string> {
  const peers = roomPresence.peersByRoomId[roomId] || [];
  return new Set(
    peers.map((peer: { accountUserId?: string }) => peer.accountUserId || '').filter((userId: string) => userId !== '')
  );
}

function roomUnreadCount(room: OwnedRoom): number {
  return roomPresence.unreadCountByRoomId[room.roomId] ?? room.unreadCount ?? 0;
}

function roomNotificationsMuted(room: OwnedRoom): boolean {
  return notificationPreferences.mutedRoomIds.includes(room.roomId);
}

function countLabel(count: number): string | number {
  return count > 99 ? '99+' : count;
}

// Only the owner gets the settings item, so only the owner gets a handler.
function settingsOpener(room: OwnedRoom): (() => void) | undefined {
  return room.relationship === 'owner' ? () => emit('openRoomSettings', room.roomId) : undefined;
}

function dismissRequestBanner(): void {
  dismissedRequestIds.value = new Set(lobby.requests.incoming.map((request) => request.id));
  dismissedRequestCount.value = requestCount.value;
}

function submitJoinCode(): void {
  if (!joinCode.value.trim()) return;
  emit('joinCode', joinCode.value);
  joinCode.value = '';
}

function openRoomContextMenu(event: MouseEvent, roomId: string): void {
  event.preventDefault();
  event.stopPropagation();
  contextRoomId.value = roomId;
  contextX.value = event.clientX;
  contextY.value = event.clientY;
  contextTrigger.value = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
}

function handleRoomKeydown(event: KeyboardEvent, roomId: string): void {
  const isContextKey = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
  if (!isContextKey || !(event.currentTarget instanceof HTMLElement)) return;
  event.preventDefault();
  event.stopPropagation();
  const rect = event.currentTarget.getBoundingClientRect();
  contextRoomId.value = roomId;
  contextX.value = rect.left + Math.min(rect.width - 12, 56);
  contextY.value = rect.top + Math.min(rect.height - 8, 44);
  contextTrigger.value = event.currentTarget;
}

function closeRoomContextMenu(): void {
  contextRoomId.value = '';
}
</script>

<template>
  <div class="voice-home">
    <div class="voice-home__content">
      <div class="voice-home__head">
        <h1 class="voice-home__title">Комнаты</h1>
        <div class="voice-home__actions">
          <!-- A room code, not a credential. iCloud Passwords ignores
           autocomplete="off" and offered its logins here, over the room list;
           a search field is the one kind it leaves alone. The data-* skip
           attributes do the same for 1Password, LastPass and Bitwarden. -->
          <form class="voice-home__join" @submit.prevent="submitJoinCode">
            <input
              v-model="joinCode"
              class="voice-home__join-input"
              type="search"
              name="room-search"
              placeholder="Код или ссылка"
              aria-label="Код или ссылка на комнату"
              aria-describedby="roomAutoSaveHint"
              autocapitalize="off"
              autocomplete="off"
              spellcheck="false"
              data-1p-ignore
              data-lpignore="true"
              data-bwignore
            />
            <span id="roomAutoSaveHint" class="voice-home__hint">Постоянные комнаты сохраняются автоматически</span>
            <button class="voice-home__join-button" type="submit" title="Постоянные комнаты сохраняются автоматически">
              Войти
            </button>
          </form>
          <Button variant="primary" size="lg" @click="emit('createRoom')">
            <template #icon><Plus v-bind="iconSm" aria-hidden="true" /></template>
            Создать комнату
          </Button>
        </div>
      </div>

      <div v-if="recoveryCodesReminder" class="voice-home__callout">
        <button class="voice-home__callout-main" type="button" @click="emit('openRecoveryCodes')">
          <span class="voice-home__callout-icon voice-home__callout-icon--warning">
            <ShieldCheck v-bind="iconMd" aria-hidden="true" />
          </span>
          <span class="voice-home__callout-copy">
            <span class="voice-home__callout-title">Защитите аккаунт</span>
            <span class="voice-home__callout-sub"
              >Создайте коды восстановления — без них забытый пароль не вернуть</span
            >
          </span>
        </button>
        <Button variant="outline" class="ui-button--compact" @click="emit('openRecoveryCodes')">Создать коды</Button>
        <button
          class="voice-home__callout-dismiss"
          type="button"
          aria-label="Напомнить через 3 дня"
          title="Напомнить через 3 дня"
          @click="emit('snoozeRecoveryCodes')"
        >
          <X v-bind="iconSm" aria-hidden="true" />
        </button>
      </div>

      <div v-if="showRequestBanner" class="voice-home__callout voice-home__callout--request">
        <span class="voice-home__callout-icon">
          <UserPlus v-bind="iconMd" aria-hidden="true" />
        </span>
        <span class="voice-home__callout-copy">
          <span class="voice-home__callout-title">
            {{ requestCount }}
            {{ requestCount === 1 ? 'новая заявка' : 'новые заявки' }} в друзья
          </span>
          <span class="voice-home__callout-sub">Откройте, чтобы принять или отклонить</span>
        </span>
        <Button variant="primary" class="ui-button--compact" @click="lobby.showPeople">Открыть</Button>
        <button
          class="voice-home__callout-dismiss"
          type="button"
          aria-label="Скрыть"
          title="Скрыть"
          @click="dismissRequestBanner"
        >
          <X v-bind="iconSm" aria-hidden="true" />
        </button>
      </div>

      <div v-if="rooms.length === 0" class="voice-home__empty">
        <span class="voice-home__empty-mark" aria-hidden="true"></span>
        <p class="voice-home__empty-text">У вас пока нет комнат — создайте первую кнопкой выше.</p>
      </div>

      <section v-if="liveRooms.length > 0" class="voice-home__section" aria-label="Сейчас в эфире">
        <h2 class="voice-home__section-title"><span class="voice-home__live-dot"></span>Сейчас в эфире</h2>
        <div class="voice-home__cards">
          <button
            v-for="room in liveRooms"
            :key="room.roomId"
            :class="['voice-home__card', { 'voice-home__card--context': contextRoomId === room.roomId }]"
            type="button"
            aria-haspopup="menu"
            @click="emit('openRoom', room.roomId)"
            @contextmenu="openRoomContextMenu($event, room.roomId)"
            @keydown="handleRoomKeydown($event, room.roomId)"
          >
            <span class="voice-home__card-head">
              <Avatar
                :name="roomDisplayName(room)"
                :src="room.avatarUrl"
                shape="squircle"
                background="var(--vr-surface-3)"
                foreground="var(--vr-text)"
                :size="40"
              />
              <Ellipsis :text="roomDisplayName(room)" class="voice-home__room-name" tag="span" />
              <span
                v-if="roomNotificationsMuted(room)"
                class="voice-home__muted"
                role="img"
                aria-label="Уведомления отключены"
                title="Уведомления отключены"
              >
                <BellOff v-bind="iconSm" aria-hidden="true" />
              </span>
              <span class="voice-home__spacer"></span>
              <Badge v-if="roomUnreadCount(room) > 0" :tone="roomNotificationsMuted(room) ? 'muted' : 'default'">
                {{ countLabel(roomUnreadCount(room)) }}
              </Badge>
            </span>
            <span class="voice-home__card-foot">
              <span class="voice-home__live-dot"></span>
              <AvatarStack :items="roomAvatars(room.roomId)" :max-avatars="5" :size="24" aria-label="В комнате" />
            </span>
          </button>
        </div>
      </section>

      <section
        v-if="quietRooms.length > 0"
        class="voice-home__section voice-home__section--quiet"
        aria-label="Остальные"
      >
        <h2 class="voice-home__section-title">Остальные</h2>
        <div class="voice-home__quiet-list">
          <button
            v-for="room in quietRooms"
            :key="room.roomId"
            :class="[
              'voice-home__card',
              'voice-home__card--quiet',
              { 'voice-home__card--context': contextRoomId === room.roomId }
            ]"
            type="button"
            aria-haspopup="menu"
            @click="emit('openRoom', room.roomId)"
            @contextmenu="openRoomContextMenu($event, room.roomId)"
            @keydown="handleRoomKeydown($event, room.roomId)"
          >
            <Avatar
              :name="roomDisplayName(room)"
              :src="room.avatarUrl"
              shape="squircle"
              background="var(--vr-surface-3)"
              foreground="var(--vr-text-2)"
              :size="32"
            />
            <Ellipsis :text="roomDisplayName(room)" class="voice-home__room-name" tag="span" />
            <span
              v-if="roomNotificationsMuted(room)"
              class="voice-home__muted"
              role="img"
              aria-label="Уведомления отключены"
              title="Уведомления отключены"
            >
              <BellOff v-bind="iconSm" aria-hidden="true" />
            </span>
            <span class="voice-home__spacer"></span>
            <Badge v-if="roomUnreadCount(room) > 0" :tone="roomNotificationsMuted(room) ? 'muted' : 'default'">
              {{ countLabel(roomUnreadCount(room)) }}
            </Badge>
            <span class="voice-home__room-sub">тихо</span>
          </button>
        </div>
      </section>
    </div>
  </div>

  <ContextMenu
    v-if="contextRoom"
    :open="Boolean(contextRoomId)"
    :x="contextX"
    :y="contextY"
    v-bind="{ ariaLabel: `Меню комнаты ${roomDisplayName(contextRoom)}` }"
    :restore-focus="contextTrigger"
    @close="closeRoomContextMenu"
  >
    <template #default="{ close }">
      <RoomMenuContent
        :key="contextRoom.roomId"
        :room-id="contextRoom.roomId"
        :name="roomDisplayName(contextRoom)"
        :avatar-url="contextRoom.avatarUrl"
        :relationship="contextRoom.relationship"
        :friends="lobby.friends"
        :present-user-ids="roomPresentUserIds(contextRoom.roomId)"
        :can-close="(roomId: string) => contextRoomId === roomId"
        :on-open-settings="settingsOpener(contextRoom)"
        @close="close"
        @rooms-changed="emit('roomsChanged')"
        @toast="(message: string) => emit('toast', message)"
      />
    </template>
  </ContextMenu>
</template>
