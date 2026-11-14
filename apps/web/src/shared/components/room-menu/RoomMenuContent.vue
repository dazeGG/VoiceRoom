<script setup lang="ts">
import { t } from '@/shared/i18n';
import { Bell, BellOff, Copy, Link, Settings, Trash2, UserRoundPlus } from '@lucide/vue';
import type { RoomRelationship } from '@voice-room/shared/contracts/rooms';
import { computed, ref } from 'vue';
import type { Friend } from '@/api/friends';
import { removeRoomFromList } from '@/api/auth';
import { useNotificationPreferencesStore } from '@/shared/notifications/preferences.store';
import { Avatar, Ellipsis, PopoverDivider, PopoverMenuItem, PopoverMenuLabel, PopoverSubmenu } from '@/shared/ui';
import { iconMd } from '@/shared/ui/icons';
import { copyText } from '@/shared/utils/clipboard';
import RoomInviteFriendList from './RoomInviteFriendList.vue';

const props = withDefaults(
  defineProps<{
    roomId: string;
    name: string;
    avatarUrl?: string | null | undefined;
    relationship?: RoomRelationship | undefined;
    friends?: Friend[] | undefined;
    presentUserIds?: Set<string> | undefined;
    canClose?: ((roomId: string) => boolean) | undefined;
    // A prop, not an emit: the settings item is shown only when someone listens.
    onOpenSettings?: (() => void) | undefined;
    showNotificationControls?: boolean | undefined;
  }>(),
  {
    avatarUrl: null,
    relationship: 'owner',
    friends: undefined,
    presentUserIds: () => new Set<string>(),
    canClose: undefined,
    onOpenSettings: undefined,
    showNotificationControls: true
  }
);

const emit = defineEmits<{
  /** Close the menu; `false` leaves the focus where it is. */
  close: [restoreFocus?: boolean];
  toast: [message: string];
  roomsChanged: [];
}>();

defineSlots<{ inviteContent?(state: { close: () => void }): unknown }>();

const preferences = useNotificationPreferencesStore();

const roomMuted = computed(() => preferences.isRoomNotificationsMuted(props.roomId));
const isOwner = computed(() => props.relationship === 'owner');
const muteSaving = ref(false);
const removeSaving = ref(false);

function stillCurrent(targetRoomId: string): boolean {
  return props.canClose?.(targetRoomId) ?? true;
}

function openSettings(): void {
  emit('close', false);
  props.onOpenSettings?.();
}

async function copyValue(value: string, successMessage: string): Promise<void> {
  const targetRoomId = props.roomId;
  try {
    await copyText(value);
    if (!stillCurrent(targetRoomId)) return;
    emit('toast', successMessage);
  } catch {
    if (!stillCurrent(targetRoomId)) return;
    emit('toast', t('Не удалось скопировать'));
  }
  if (stillCurrent(targetRoomId)) emit('close');
}

function copyLink(): Promise<void> {
  return copyValue(`${window.location.origin}/r/${encodeURIComponent(props.roomId)}`, t('Ссылка скопирована'));
}

async function toggleRoomMute(): Promise<void> {
  if (!props.showNotificationControls) return;
  if (muteSaving.value) return;
  muteSaving.value = true;
  const targetRoomId = props.roomId;
  const nextMuted = !roomMuted.value;
  try {
    await preferences.updateRoomNotificationsMuted(targetRoomId, nextMuted);
    if (stillCurrent(targetRoomId)) emit('close');
  } catch {
    if (stillCurrent(targetRoomId)) emit('toast', t('Не удалось изменить уведомления'));
  } finally {
    muteSaving.value = false;
  }
}

async function removeBookmark(): Promise<void> {
  if (isOwner.value || removeSaving.value) return;
  removeSaving.value = true;
  const targetRoomId = props.roomId;
  try {
    await removeRoomFromList(targetRoomId);
    if (!stillCurrent(targetRoomId)) return;
    emit('toast', t('Комната «{p0}» удалена из списка', { p0: props.name }));
    emit('close', false);
    emit('roomsChanged');
  } catch (error) {
    if (stillCurrent(targetRoomId)) {
      emit(
        'toast',
        error instanceof Error && error.message ? error.message : t('Не удалось удалить комнату из списка')
      );
    }
  } finally {
    removeSaving.value = false;
  }
}
</script>

<template>
  <div class="room-menu-content" data-room-menu-content>
    <div class="room-menu-content__head">
      <Avatar :name="name" :src="avatarUrl" shape="squircle" background="var(--vr-surface-3)" :size="44" />
      <div class="room-menu-content__info">
        <Ellipsis class="room-menu-content__name" :text="name" />
        <Ellipsis class="room-menu-content__code" :text="roomId" />
      </div>
    </div>

    <PopoverDivider />
    <PopoverMenuLabel :text="t('Комната')" />

    <PopoverSubmenu
      v-if="$slots.inviteContent"
      :label="t('Пригласить')"
      :aria-label="t('Позвать друга в {p0}', { p0: name })"
    >
      <template #icon><UserRoundPlus v-bind="iconMd" aria-hidden="true" /></template>
      <slot name="inviteContent" :close="() => emit('close')" />
    </PopoverSubmenu>
    <PopoverSubmenu v-else-if="friends" :label="t('Пригласить')" :aria-label="t('Позвать друга в {p0}', { p0: name })">
      <template #icon><UserRoundPlus v-bind="iconMd" aria-hidden="true" /></template>
      <template #default="{ close: closeSubmenu }">
        <RoomInviteFriendList
          :friends="friends"
          :room-id="roomId"
          :present-user-ids="presentUserIds"
          @toast="emit('toast', $event)"
          @close="
            closeSubmenu();
            emit('close');
          "
        />
      </template>
    </PopoverSubmenu>

    <PopoverMenuItem :label="t('Скопировать код')" @click="void copyValue(roomId, t('Код скопирован'))">
      <template #icon><Copy v-bind="iconMd" aria-hidden="true" /></template>
    </PopoverMenuItem>

    <PopoverMenuItem :label="t('Скопировать ссылку')" @click="void copyLink()">
      <template #icon><Link v-bind="iconMd" aria-hidden="true" /></template>
    </PopoverMenuItem>

    <template v-if="showNotificationControls">
      <PopoverDivider />
      <PopoverMenuItem
        :label="roomMuted ? t('Включить уведомления') : t('Выключить уведомления')"
        :disabled="muteSaving"
        @click="void toggleRoomMute()"
      >
        <template #icon>
          <BellOff v-if="roomMuted" v-bind="iconMd" aria-hidden="true" />
          <Bell v-else v-bind="iconMd" aria-hidden="true" />
        </template>
      </PopoverMenuItem>
    </template>

    <PopoverDivider />
    <PopoverMenuItem v-if="isOwner && onOpenSettings" :label="t('Настройки комнаты')" @click="openSettings">
      <template #icon><Settings v-bind="iconMd" aria-hidden="true" /></template>
    </PopoverMenuItem>
    <PopoverMenuItem
      v-else-if="!isOwner"
      :label="t('Удалить из списка')"
      variant="danger"
      :disabled="removeSaving"
      @click="void removeBookmark()"
    >
      <template #icon><Trash2 v-bind="iconMd" aria-hidden="true" /></template>
    </PopoverMenuItem>
  </div>
</template>
