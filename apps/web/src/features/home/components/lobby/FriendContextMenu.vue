<script setup lang="ts">
import { isOfficialAccount } from '@voiceroom/shared/official-account';
import { Ban, Bell, BellOff, CheckCheck, MessageSquare, Trash2, UserRound, UserMinus, UserPlus } from '@lucide/vue';
import { computed, ref } from 'vue';
import type { Friend } from '@/api/friends';
import CallEntryIcon from '@/features/friend-call/CallEntryIcon.vue';
import { useProfileCardUiStore } from '@/entities/profile-card/profile-card-ui.store';
import { t } from '@/shared/i18n';
import { useNotificationPreferencesStore } from '@/shared/notifications/preferences.store';
import { effectivePresenceStatus } from '@/shared/presence';
import { ContextMenu, MenuSeparator, MenuItem, MenuLabel } from '@voiceroom/ui-kit/components';
import { iconSm } from '@voiceroom/ui-kit/icon-defaults';
import { displayNameOf } from '@/shared/utils/display-name';
import { useFriendMenuCall, type FriendMenuTarget } from '../../model/friend-menu';
import { useLobby } from '../../model/lobby-context';
import BlockContactDialog from './BlockContactDialog.vue';
import DeleteConversationDialog from './DeleteConversationDialog.vue';

const target = defineModel<FriendMenuTarget | null>({ required: true });
const {
  onMarkRead = null,
  onMarkUnread = null,
  isUnread = null
} = defineProps<{
  onMarkRead?: ((userId: string) => Promise<void>) | null;
  onMarkUnread?: ((userId: string) => void) | null;
  isUnread?: ((userId: string) => boolean) | null;
}>();
const emit = defineEmits<{ toast: [message: string] }>();
const lobby = useLobby();
const preferences = useNotificationPreferencesStore();
const { openProfileCardFor } = useProfileCardUiStore();
const blockTarget = ref<Friend['user'] | null>(null);
const deleteTarget = ref<Friend['user'] | null>(null);
const friend = computed(() => target.value?.friend.user);
const name = computed(() => (friend.value ? displayNameOf(friend.value) : ''));
// The official VoiceRoom account: no call, profile, friendship or block.
const official = computed(() => isOfficialAccount(friend.value));
const isFriend = computed(() => !official.value && target.value?.isFriend !== false);
const muted = computed(() =>
  preferences.notificationPreferences.loaded
    ? preferences.isPeerNotificationsMuted(friend.value?.id)
    : Boolean(target.value?.muted)
);
const call = useFriendMenuCall(() => target.value);

function openCall(close: () => void): void {
  const open = call.value.open;
  close();
  void open();
}

async function run(action: () => Promise<void>, failure: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    emit('toast', error instanceof Error && error.message ? error.message : failure);
  }
}

function message(close: (restoreFocus?: boolean) => void): void {
  const userId = friend.value?.id;
  if (!userId) return;
  close(false);
  void run(() => lobby.openDm(userId), t('Не удалось открыть личные сообщения'));
}

function profile(close: (restoreFocus?: boolean) => void): void {
  const current = target.value;
  if (!current) return;
  const { friend: entry, anchor } = current;
  const { id, login, avatarUrl, avatarColorKey, avatarAccent } = entry.user;
  const presence = effectivePresenceStatus(entry.online, entry.user.presenceStatus, entry.user.doNotDisturb);
  close(false);
  queueMicrotask(() =>
    openProfileCardFor(
      { userId: id, name: displayNameOf(entry.user), login, avatarUrl, avatarColorKey, avatarAccent, presence },
      anchor
    )
  );
}

function markRead(close: () => void): void {
  const userId = friend.value?.id;
  if (!userId || !onMarkRead) return;
  close();
  if (isUnread?.(userId)) void run(() => onMarkRead(userId), t('Не удалось отметить прочитанное'));
  else onMarkUnread?.(userId);
}

function addFriend(close: () => void): void {
  const userId = friend.value?.id;
  if (!userId) return;
  close();
  void run(async () => {
    await lobby.addFriendByUserId(userId);
    emit('toast', t('Заявка в друзья отправлена'));
  }, t('Не удалось отправить заявку'));
}

function toggleMute(close: () => void): void {
  const userId = friend.value?.id;
  if (!userId) return;
  const nextMuted = !muted.value;
  close();
  void run(() => preferences.updatePeerNotificationsMuted(userId, nextMuted), t('Не удалось изменить уведомления'));
}

function remove(close: () => void): void {
  const userId = friend.value?.id;
  const friendName = name.value;
  if (!userId) return;
  close();
  void run(async () => {
    await lobby.removeFriend(userId);
    emit('toast', t('{p0} удалён из друзей', { p0: friendName }));
  }, t('Не удалось удалить друга'));
}

function requestBlock(close: (restoreFocus?: boolean) => void): void {
  if (!friend.value) return;
  blockTarget.value = friend.value;
  close(false);
}

function confirmBlock(deleteConversation: boolean): void {
  const user = blockTarget.value;
  blockTarget.value = null;
  if (!user) return;
  void run(async () => {
    await lobby.blockUser(user.id, deleteConversation);
    emit('toast', t('{p0} заблокирован', { p0: displayNameOf(user) }));
  }, t('Не удалось заблокировать пользователя'));
}

function requestDelete(close: (restoreFocus?: boolean) => void): void {
  if (!friend.value) return;
  deleteTarget.value = friend.value;
  close(false);
}

function confirmDelete(): void {
  const user = deleteTarget.value;
  deleteTarget.value = null;
  if (user) void run(() => lobby.deleteConversation(user.id), t('Не удалось удалить переписку'));
}
</script>

<template>
  <ContextMenu
    v-if="target"
    open
    :x="target.x"
    :y="target.y"
    v-bind="{ ariaLabel: t('Действия для {p0}', { p0: name }) }"
    :restore-focus="target.anchor"
    @close="target = null"
  >
    <template #default="{ close }">
      <MenuLabel :text="official || isFriend ? name : t('Не друг')" />
      <MenuItem v-if="!onMarkRead" :label="t('Написать')" @select.prevent="message(close)">
        <template #icon><MessageSquare v-bind="iconSm" /></template>
      </MenuItem>
      <MenuItem
        v-if="!official && call.visible && target.canCall !== false"
        :label="call.menuLabel"
        :hint="call.menuHint"
        :tone="call.accent ? 'accent' : 'default'"
        :disabled="call.disabled"
        @select.prevent="openCall(close)"
      >
        <template #icon><CallEntryIcon :mode="call.mode" v-bind="iconSm" /></template>
      </MenuItem>
      <MenuItem v-if="!official" :label="t('Профиль')" @select.prevent="profile(close)">
        <template #icon><UserRound v-bind="iconSm" /></template>
      </MenuItem>
      <MenuItem v-if="!isFriend && !official" :label="t('Добавить в друзья')" @select.prevent="addFriend(close)">
        <template #icon><UserPlus v-bind="iconSm" /></template>
      </MenuItem>
      <MenuItem
        v-if="onMarkRead"
        :label="friend && isUnread?.(friend.id) ? t('Отметить прочитанным') : t('Отметить непрочитанным')"
        @select.prevent="markRead(close)"
      >
        <template #icon><CheckCheck v-bind="iconSm" /></template>
      </MenuItem>
      <MenuItem
        :label="muted ? t('Включить уведомления') : t('Выключить уведомления')"
        @select.prevent="toggleMute(close)"
      >
        <template #icon><component :is="muted ? BellOff : Bell" v-bind="iconSm" /></template>
      </MenuItem>
      <MenuSeparator />
      <MenuItem v-if="onMarkRead" :label="t('Удалить переписку')" tone="danger" @select.prevent="requestDelete(close)">
        <template #icon><Trash2 v-bind="iconSm" /></template>
      </MenuItem>
      <MenuItem v-if="isFriend" :label="t('Удалить из друзей')" tone="danger" @select.prevent="remove(close)">
        <template #icon><UserMinus v-bind="iconSm" /></template>
      </MenuItem>
      <MenuItem v-if="!official" :label="t('Заблокировать')" tone="danger" @select.prevent="requestBlock(close)">
        <template #icon><Ban v-bind="iconSm" /></template>
      </MenuItem>
    </template>
  </ContextMenu>

  <BlockContactDialog v-if="blockTarget" :user="blockTarget" @close="blockTarget = null" @confirm="confirmBlock" />
  <DeleteConversationDialog
    v-if="deleteTarget"
    :login="deleteTarget.login"
    @close="deleteTarget = null"
    @confirm="confirmDelete"
  />
</template>
