<script setup lang="ts">
import { Ban, Bell, BellOff, CheckCheck, MessageSquare, UserRound, UserMinus } from '@lucide/vue';
import { computed, ref } from 'vue';
import type { Friend } from '@/api/friends';
import CallEntryIcon from '@/features/friend-call/CallEntryIcon.vue';
import { useProfileCardUiStore } from '@/entities/profile-card/profile-card-ui.store';
import { t } from '@/shared/i18n';
import { useNotificationPreferencesStore } from '@/shared/notifications/preferences.store';
import { effectivePresenceStatus } from '@/shared/presence';
import { Button, ContextMenu, Dialog, MenuSeparator, MenuItem, MenuLabel } from '@voiceroom/ui-kit/components';
import { iconSm } from '@voiceroom/ui-kit/icon-defaults';
import { displayNameOf } from '@/shared/utils/display-name';
import { useFriendMenuCall, type FriendMenuTarget } from '../../model/friend-menu';
import { useLobby } from '../../model/lobby-context';

const target = defineModel<FriendMenuTarget | null>({ required: true });
const { onMarkRead = null } = defineProps<{ onMarkRead?: ((userId: string) => Promise<void>) | null }>();
const emit = defineEmits<{ toast: [message: string] }>();
const lobby = useLobby();
const preferences = useNotificationPreferencesStore();
const { openProfileCardFor } = useProfileCardUiStore();
const blockTarget = ref<Friend['user'] | null>(null);
const friend = computed(() => target.value?.friend.user);
const name = computed(() => (friend.value ? displayNameOf(friend.value) : ''));
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
  void run(() => onMarkRead(userId), t('Не удалось отметить прочитанное'));
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

function confirmBlock(): void {
  const user = blockTarget.value;
  blockTarget.value = null;
  if (!user) return;
  void run(async () => {
    await lobby.blockUser(user.id);
    emit('toast', t('{p0} заблокирован', { p0: displayNameOf(user) }));
  }, t('Не удалось заблокировать пользователя'));
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
      <MenuLabel :text="name" />
      <MenuItem v-if="!onMarkRead" :label="t('Написать')" @select.prevent="message(close)">
        <template #icon><MessageSquare v-bind="iconSm" /></template>
      </MenuItem>
      <MenuItem
        v-if="call.visible"
        :label="call.menuLabel"
        :hint="call.menuHint"
        :tone="call.accent ? 'accent' : 'default'"
        :disabled="call.disabled"
        @select.prevent="openCall(close)"
      >
        <template #icon><CallEntryIcon :mode="call.mode" v-bind="iconSm" /></template>
      </MenuItem>
      <MenuItem :label="t('Профиль')" @select.prevent="profile(close)">
        <template #icon><UserRound v-bind="iconSm" /></template>
      </MenuItem>
      <MenuItem v-if="onMarkRead" :label="t('Отметить прочитанным')" @select.prevent="markRead(close)">
        <template #icon><CheckCheck v-bind="iconSm" /></template>
      </MenuItem>
      <MenuItem
        :label="muted ? t('Включить уведомления') : t('Выключить уведомления')"
        @select.prevent="toggleMute(close)"
      >
        <template #icon><component :is="muted ? BellOff : Bell" v-bind="iconSm" /></template>
      </MenuItem>
      <MenuSeparator />
      <MenuItem :label="t('Удалить из друзей')" tone="danger" @select.prevent="remove(close)">
        <template #icon><UserMinus v-bind="iconSm" /></template>
      </MenuItem>
      <MenuItem :label="t('Заблокировать')" tone="danger" @select.prevent="requestBlock(close)">
        <template #icon><Ban v-bind="iconSm" /></template>
      </MenuItem>
    </template>
  </ContextMenu>

  <Dialog
    v-if="blockTarget"
    open
    :title="t('Заблокировать {p0}?', { p0: displayNameOf(blockTarget) })"
    :on-close="() => (blockTarget = null)"
    initial-focus="[data-friend-block-cancel]"
  >
    <p>{{ t('Пользователь больше не сможет писать вам и звать в комнаты. Дружба будет разорвана.') }}</p>
    <template #footer>
      <Button variant="ghost" type="button" data-friend-block-cancel @click="blockTarget = null">{{
        t('Отмена')
      }}</Button>
      <Button variant="danger" type="button" @click="confirmBlock">{{ t('Заблокировать') }}</Button>
    </template>
  </Dialog>
</template>
