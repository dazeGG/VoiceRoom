<script setup lang="ts">
import {
  NavList,
  NavListGroup,
  NavListItem,
  Spinner,
  AlertDialog,
  Button,
  Dialog,
  Field,
  TextField,
  Select
} from '@voiceroom/ui-kit/components';
import { useLocalizedText, currentErrorMessage } from '@/shared/i18n/localized-text';

import { t } from '@/shared/i18n';
import { Ban, SlidersHorizontal, Users } from '@lucide/vue';
import { Value } from 'typebox/value';
import { computed, ref, watch } from 'vue';
import { NotificationLevel } from '@voiceroom/shared/contracts/notifications';
import { fetchRoomNotificationLevel, setRoomNotificationLevel, type RoomNotificationLevel } from '@/api/notifications';
import { deleteRoom, updateRoom } from '@/api/rooms';
import ModerationCenter from '@/entities/room/components/ModerationCenter.vue';
import RoomAvatarField from '@/entities/room/components/RoomAvatarField.vue';
import RoomMemberList from '@/entities/room/components/RoomMemberList.vue';
import { saveRoomAvatarChange, type RoomAvatarChange } from '@/entities/room/room-avatar-change';
import { APP_HOME } from '@/shared/app-home';
import { BAN_UNDO_DURATION_MS, type ModerationNoticeOptions } from '@/entities/room/room-moderation';
import { state as roomClientState } from '@voiceroom/call/engine/core/room-runtime.store';
import { applyRoomUpdated } from '@voiceroom/call/engine/room/lifecycle';
import { showToast } from '@voiceroom/call/engine/ui/toast';
import { useRoomSettingsStore } from '../room-settings.store';
import { useRoomShell } from '../shell';

type Section = 'general' | 'members' | 'bans';

const shell = useRoomShell();
const roomSettingsUi = useRoomSettingsStore();

const name = ref('');
const error = useLocalizedText();
const deleteError = useLocalizedText();
const saving = ref(false);
const confirmingDelete = ref(false);
const deleting = ref(false);
const avatarChange = ref<RoomAvatarChange>({ kind: 'keep' });
const cropOpen = ref(false);
const notificationLevel = ref<RoomNotificationLevel>('mentions');
const notificationSaving = ref(false);
const section = ref<Section>('general');
// Save waits until the name or the picture actually changes.
const dirty = computed(() => name.value.trim() !== roomClientState.roomName || avatarChange.value.kind !== 'keep');

// Reset the form from the live room state each time the dialog opens: the room
// state is snapshotted here rather than bound continuously.
watch(
  () => roomSettingsUi.open,
  (open) => {
    if (!open) return;
    void fetchRoomNotificationLevel(roomClientState.roomId)
      .catch(() => 'mentions' as const)
      .then((level) => (notificationLevel.value = level));
    section.value = 'general';
    name.value = roomClientState.roomName;
    error.value = '';
    confirmingDelete.value = false;
    avatarChange.value = { kind: 'keep' };
  },
  { immediate: true }
);

async function save(): Promise<void> {
  if (saving.value) return;
  const trimmed = name.value.trim();
  if (!trimmed) {
    error.value = () => t('Дайте комнате название');
    return;
  }

  saving.value = true;
  error.value = '';
  try {
    let room = await updateRoom(roomClientState.roomId, { name: trimmed });
    room = (await saveRoomAvatarChange(roomClientState.roomId, avatarChange.value)) ?? room;
    applyRoomUpdated(room);
    shell.roomsChanged(room.roomId);
    roomSettingsUi.closeRoomSettings();
    showToast(t('Комната обновлена'));
  } catch (err) {
    error.value = () =>
      err instanceof Error && currentErrorMessage(err) ? currentErrorMessage(err) : t('Не удалось сохранить изменения');
  } finally {
    saving.value = false;
  }
}

async function confirmDelete(): Promise<void> {
  if (deleting.value) return;
  deleting.value = true;
  deleteError.value = '';
  roomSettingsUi.deleting = true;
  try {
    await deleteRoom(roomClientState.roomId);
    window.location.href = APP_HOME;
  } catch (err) {
    deleting.value = false;
    roomSettingsUi.deleting = false;
    deleteError.value = () =>
      err instanceof Error && currentErrorMessage(err) ? currentErrorMessage(err) : t('Не удалось удалить комнату');
  }
}

function openDeleteConfirmation(): void {
  deleteError.value = '';
  confirmingDelete.value = true;
}

function cancelDeleteConfirmation(): void {
  if (!deleting.value) confirmingDelete.value = false;
}

async function saveNotificationLevel(value: string): Promise<void> {
  if (!Value.Check(NotificationLevel, value)) return;
  notificationLevel.value = value;
  notificationSaving.value = true;
  try {
    await setRoomNotificationLevel(roomClientState.roomId, notificationLevel.value);
  } catch (value) {
    error.value = () => (value instanceof Error ? currentErrorMessage(value) : t('Не удалось сохранить уведомления'));
  } finally {
    notificationSaving.value = false;
  }
}

function notifyModeration(message: string, options: ModerationNoticeOptions = {}): void {
  showToast(message, {
    variant: options.variant,
    description: options.description,
    actionLabel: options.undo?.label,
    action: options.undo?.run,
    duration: options.undo ? BAN_UNDO_DURATION_MS : undefined
  });
}

// A member menu open inside the dialog owns Escape: it closes the menu, not
// the whole dialog underneath it.
function hasOpenPopover(): boolean {
  return Boolean(document.querySelector('.popover-submenu__panel, .popover__panel--floating'));
}

function onClose(): void {
  if (saving.value || deleting.value || cropOpen.value || hasOpenPopover()) return;
  roomSettingsUi.closeRoomSettings();
}

function onCancel(): void {
  if (saving.value || deleting.value || cropOpen.value) return;
  roomSettingsUi.closeRoomSettings();
}
</script>

<template>
  <Dialog :open="roomSettingsUi.open" :title="t('Настройки комнаты')" size="xl" trim="flush" :on-close="onClose">
    <div class="settings__body settings__body--room">
      <NavList class="settings__nav" :label="t('Разделы настроек комнаты')">
        <NavListGroup class="settings__nav-main">
          <NavListItem :label="t('Основное')" :current="section === 'general'" @click="section = 'general'">
            <template #icon><SlidersHorizontal /></template>
          </NavListItem>
          <NavListItem :label="t('Участники')" :current="section === 'members'" @click="section = 'members'">
            <template #icon><Users /></template>
          </NavListItem>
          <NavListItem :label="t('Блокировки')" :current="section === 'bans'" @click="section = 'bans'">
            <template #icon><Ban /></template>
          </NavListItem>
        </NavListGroup>
      </NavList>

      <div v-if="section === 'members'" class="settings__content room-settings__content">
        <RoomMemberList :room-id="roomClientState.roomId" can-moderate :on-notify="notifyModeration" />
      </div>
      <div v-else-if="section === 'bans'" class="settings__content room-settings__content">
        <ModerationCenter :room-id="roomClientState.roomId" :on-notify="notifyModeration" />
      </div>
      <form v-else class="settings__content room-settings__content" @submit.prevent="save">
        <p v-if="error" class="dialog__error" role="alert">{{ error }}</p>

        <div class="room-settings__profile-head">
          <RoomAvatarField
            v-model:change="avatarChange"
            v-model:cropping="cropOpen"
            :saved-url="roomClientState.roomAvatarUrl"
            :name="name || roomClientState.roomId"
            @error="(message: string) => (error = message)"
          />
          <Field class="room-settings__name-field" :label="t('Название')">
            <TextField v-model="name" maxlength="60" :placeholder="t('Название комнаты')" />
          </Field>
        </div>

        <Field class="room-settings__notifications" :label="t('Уведомления комнаты')">
          <Select
            :model-value="notificationLevel"
            :disabled="notificationSaving"
            :options="[
              { value: 'all', label: t('Все сообщения') },
              { value: 'mentions', label: t('Упоминания и ответы') },
              { value: 'none', label: t('Выключены') }
            ]"
            @value-change="saveNotificationLevel"
          />
        </Field>

        <div class="settings__actions">
          <Button variant="plain" class="settings__cancel" @click="onCancel">{{ t('Отмена') }}</Button>
          <Button variant="primary" class="settings__save" type="submit" :disabled="saving || !dirty">
            <Spinner v-if="saving" aria-hidden="true" /> {{ t('Сохранить') }}
          </Button>
        </div>

        <div class="dialog__danger-zone">
          <Button variant="danger-ghost" @click="openDeleteConfirmation">
            {{ t('Удалить комнату') }}
          </Button>
          <AlertDialog
            :open="confirmingDelete"
            :title="t('Удалить комнату «{p0}»?', { p0: roomClientState.roomName || roomClientState.roomId })"
            :description="t('Комната будет удалена для всех участников. Это действие нельзя отменить.')"
            :confirm-label="deleting ? t('Удаляем…') : t('Удалить')"
            tone="danger"
            :busy="deleting"
            @cancel="cancelDeleteConfirmation"
            @confirm="confirmDelete"
          >
            <p v-if="deleteError" class="dialog__error" role="alert">{{ deleteError }}</p>
          </AlertDialog>
        </div>
      </form>
    </div>
  </Dialog>
</template>
