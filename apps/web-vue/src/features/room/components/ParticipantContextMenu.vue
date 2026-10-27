<script setup lang="ts">
import { Ban, Check, LogOut, MessageSquare, MicOff, User, UserMinus, UserPlus, Volume2, VolumeX } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { banRoomPeer, kickRoomPeer, setRoomPeerServerMute, undoRoomBan } from '@/api/rooms';
import { useSessionStore } from '@/features/auth/session.store';
import { useProfileCardUiStore } from '@/entities/profile-card/profile-card-ui.store';
import { ContextMenu, PopoverDivider, PopoverMenuItem, PopoverMenuLabel, Slider } from '@/shared/ui';
import { iconMd, iconSm } from '@/shared/ui/icons';
import {
  getParticipantAudioPreference,
  getParticipantAudioPreferenceKey,
  storeParticipantAudioPreference
} from '../client/core/settings';
import { state as roomState } from '../client/core/room-runtime.store';
import { applyRemoteParticipantAudioPreferences } from '../client/services/media-playback-service';
import { getParticipantById } from '../client/room/participants';
import { showToast } from '../client/ui/toast';
import { useParticipantContextUiStore } from '../participant-context-ui.store';
import { participantProfilePerson } from '../profile-card-adapter';
import { useRoomSettingsStore } from '../room-settings.store';
import { useRoomSocial } from '../social';

const social = useRoomSocial();
const session = useSessionStore();
const participantContextMenu = useParticipantContextUiStore();
const roomSettingsUi = useRoomSettingsStore();
const { openProfileCardFor } = useProfileCardUiStore();

const volumePercent = ref(100);
const localMuted = ref(false);
const moderating = ref(false);

const volumeLabel = computed(() => `${Math.round(volumePercent.value)}%`);
const peer = computed(() => (participantContextMenu.open ? getParticipantById(participantContextMenu.peerId) : null));
const preferenceKey = computed(() =>
  peer.value ? getParticipantAudioPreferenceKey(peer.value.accountUserId, peer.value.id) : ''
);
// Volume, local mute and forced mute only make sense from a grid tile, where
// you are actually listening to this person.
const showAudioControls = computed(() => participantContextMenu.variant === 'tile');
const canUseSocialActions = computed(() =>
  Boolean(peer.value && session.user && peer.value.accountUserId && peer.value.accountUserId !== session.user?.id)
);
const canModerate = computed(() => Boolean(peer.value && roomSettingsUi.isOwner && !peer.value.isLocal));
const relationship = computed(() =>
  canUseSocialActions.value && peer.value?.accountUserId ? social.relationship(peer.value.accountUserId) : 'none'
);

watch(
  [peer, preferenceKey],
  () => {
    if (!peer.value || !preferenceKey.value) return;
    const preference = getParticipantAudioPreference(preferenceKey.value);
    volumePercent.value = Math.round(preference.volume * 100);
    localMuted.value = preference.muted;
  },
  { immediate: true }
);

function setVolume(percent: number): void {
  if (!peer.value || !preferenceKey.value) return;
  const safePercent = Math.min(200, Math.max(0, Number.isFinite(percent) ? percent : 100));
  volumePercent.value = safePercent;
  storeParticipantAudioPreference(preferenceKey.value, { volume: safePercent / 100 });
  applyRemoteParticipantAudioPreferences(peer.value);
}

function errorToastMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

// Every action closes the menu first so the result is visible immediately;
// failures surface as a toast rather than by leaving the menu hanging open.
function act(action: () => Promise<void>, fallback: string): void {
  if (!peer.value || moderating.value) return;
  moderating.value = true;
  participantContextMenu.closeParticipantContextMenu(peer.value.id, false);
  void action()
    .catch((error: unknown) => showToast(errorToastMessage(error, fallback), { variant: 'error' }))
    .finally(() => {
      moderating.value = false;
    });
}

function showProfile(event: MouseEvent): void {
  const current = peer.value;
  if (!current?.accountUserId) return;
  const person = participantProfilePerson(social, current);
  const anchor = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  const anchorRect = anchor?.getBoundingClientRect() ?? null;
  const restoreFocus = participantContextMenu.restoreFocus;
  participantContextMenu.closeParticipantContextMenu(current.id, false);
  // Deferred so the closing menu does not swallow the card's own outside-click
  // listener during the same pointer event.
  queueMicrotask(() => openProfileCardFor(person, { rect: anchorRect, restoreFocus }));
}

function toggleLocalMute(): void {
  if (!peer.value || !preferenceKey.value) return;
  const next = storeParticipantAudioPreference(preferenceKey.value, {
    muted: !getParticipantAudioPreference(preferenceKey.value).muted
  });
  localMuted.value = next.muted;
  applyRemoteParticipantAudioPreferences(peer.value);
  participantContextMenu.closeParticipantContextMenu(peer.value.id);
}

function openDirectMessage(): void {
  const accountUserId = peer.value?.accountUserId;
  if (!accountUserId) return;
  act(async () => {
    social.showFriends();
    await social.openDm(accountUserId);
  }, 'Не удалось открыть личные сообщения');
}

function sendFriendRequest(): void {
  const accountUserId = peer.value?.accountUserId;
  if (!accountUserId) return;
  act(async () => {
    const result = await social.addFriend(accountUserId);
    showToast(friendRequestToast(result.status));
  }, 'Не удалось отправить заявку в друзья');
}

function acceptFriendRequest(): void {
  const accountUserId = peer.value?.accountUserId;
  if (!accountUserId) return;
  act(async () => {
    await social.acceptRequest(accountUserId);
    showToast('Заявка принята');
  }, 'Не удалось принять заявку в друзья');
}

function dropFriend(): void {
  const accountUserId = peer.value?.accountUserId;
  const name = peer.value?.name ?? 'Пользователь';
  if (!accountUserId) return;
  act(async () => {
    await social.removeFriend(accountUserId);
    showToast(`${name} удалён из друзей`);
  }, 'Не удалось удалить из друзей');
}

function toggleServerMute(): void {
  if (!peer.value) return;
  const peerId = peer.value.id;
  const name = peer.value.name;
  const next = !peer.value.serverMuted;
  act(async () => {
    await setRoomPeerServerMute(roomState.roomId, peerId, next);
    showToast(next ? `Микрофон ${name} выключен` : `Микрофон ${name} включён`);
  }, 'Не удалось изменить микрофон участника');
}

function kickParticipant(): void {
  if (!peer.value) return;
  const peerId = peer.value.id;
  const name = peer.value.name;
  act(async () => {
    await kickRoomPeer(roomState.roomId, peerId);
    showToast(`${name} исключён из комнаты`);
  }, 'Не удалось исключить участника');
}

function banParticipant(): void {
  if (!peer.value) return;
  const peerId = peer.value.id;
  const peerName = peer.value.name;
  act(async () => {
    const banId = await banRoomPeer(roomState.roomId, peerId);
    showToast(`${peerName} заблокирован`, {
      actionLabel: 'Отменить',
      duration: 10000,
      action: async () => {
        try {
          await undoRoomBan(roomState.roomId, banId);
          showToast('Блокировка отменена');
        } catch (error) {
          showToast(errorToastMessage(error, 'Не удалось отменить блокировку'), { variant: 'error' });
        }
      }
    });
  }, 'Не удалось заблокировать участника');
}

function friendRequestToast(status: 'sent' | 'accepted' | 'already_sent' | 'already_friends'): string {
  switch (status) {
    case 'accepted':
      return 'Теперь вы друзья';
    case 'already_friends':
      return 'Уже в друзьях';
    case 'already_sent':
      return 'Заявка уже отправлена';
    case 'sent':
    default:
      return 'Заявка в друзья отправлена';
  }
}
</script>

<template>
  <ContextMenu
    v-if="participantContextMenu.open && peer && !peer.isLocal"
    :open="participantContextMenu.open"
    :x="participantContextMenu.x"
    :y="participantContextMenu.y"
    v-bind="{ ariaLabel: `Действия для ${peer.name}` }"
    :restore-focus="participantContextMenu.restoreFocus"
    role="dialog"
    @close="participantContextMenu.closeParticipantContextMenu('', false)"
  >
    <div class="participant-menu" :data-peer-id="peer.id">
      <PopoverMenuLabel :text="showAudioControls ? 'Плитка в сетке' : 'Участник'" />

      <PopoverMenuItem v-if="peer.accountUserId" role="button" label="Профиль" @click="showProfile">
        <template #icon><User v-bind="iconMd" aria-hidden="true" /></template>
      </PopoverMenuItem>

      <template v-if="canUseSocialActions">
        <PopoverMenuItem role="button" label="Написать" @click="openDirectMessage">
          <template #icon><MessageSquare v-bind="iconMd" aria-hidden="true" /></template>
        </PopoverMenuItem>

        <PopoverMenuItem
          v-if="relationship === 'friend'"
          role="button"
          label="Удалить из друзей"
          variant="danger"
          @click="dropFriend"
        >
          <template #icon><UserMinus v-bind="iconMd" aria-hidden="true" /></template>
        </PopoverMenuItem>
        <PopoverMenuItem
          v-else-if="relationship === 'incoming'"
          role="button"
          label="Принять заявку"
          variant="friendly"
          @click="acceptFriendRequest"
        >
          <template #icon><Check v-bind="iconMd" aria-hidden="true" /></template>
        </PopoverMenuItem>
        <PopoverMenuItem
          v-else-if="relationship === 'outgoing'"
          role="button"
          label="Заявка отправлена"
          variant="friendly"
          disabled
        >
          <template #icon><UserPlus v-bind="iconMd" aria-hidden="true" /></template>
        </PopoverMenuItem>
        <PopoverMenuItem v-else role="button" label="Добавить в друзья" variant="friendly" @click="sendFriendRequest">
          <template #icon><UserPlus v-bind="iconMd" aria-hidden="true" /></template>
        </PopoverMenuItem>
      </template>
      <p v-else-if="!peer.accountUserId" class="participant-menu__note">
        Гость: доступны только локальные настройки звука.
      </p>

      <template v-if="showAudioControls">
        <PopoverDivider />

        <div class="participant-menu__volume">
          <div class="participant-menu__volume-head">
            <span class="participant-menu__volume-label">
              <Volume2 v-bind="iconSm" aria-hidden="true" />
              <span>Громкость</span>
            </span>
            <output class="participant-menu__volume-value">{{ volumeLabel }}</output>
          </div>
          <Slider
            v-model="volumePercent"
            :min="0"
            :max="200"
            :step="1"
            :default-value="100"
            snap
            :snap-threshold="6"
            :aria-label="`Громкость ${peer.name}`"
            :aria-value-text="volumeLabel"
            @value-change="setVolume"
          />
        </div>

        <PopoverMenuItem
          role="button"
          :label="localMuted ? 'Включить для меня' : 'Заглушить для меня'"
          :variant="localMuted ? 'accent' : 'default'"
          @click="toggleLocalMute"
        >
          <template #icon><VolumeX v-bind="iconMd" aria-hidden="true" /></template>
        </PopoverMenuItem>
      </template>

      <template v-if="canModerate">
        <PopoverDivider />
        <PopoverMenuLabel text="Модерация" />

        <PopoverMenuItem
          v-if="showAudioControls"
          role="button"
          :label="peer.serverMuted ? 'Включить микрофон' : 'Выключить микрофон'"
          :disabled="moderating"
          @click="toggleServerMute"
        >
          <template #icon><MicOff v-bind="iconMd" aria-hidden="true" /></template>
        </PopoverMenuItem>

        <PopoverMenuItem
          role="button"
          label="Исключить из комнаты"
          variant="danger"
          :disabled="moderating"
          @click="kickParticipant"
        >
          <template #icon><LogOut v-bind="iconMd" aria-hidden="true" /></template>
        </PopoverMenuItem>
        <PopoverMenuItem
          role="button"
          label="Заблокировать в комнате"
          variant="danger"
          :disabled="moderating"
          @click="banParticipant"
        >
          <template #icon><Ban v-bind="iconMd" aria-hidden="true" /></template>
        </PopoverMenuItem>
      </template>
    </div>
  </ContextMenu>
</template>
