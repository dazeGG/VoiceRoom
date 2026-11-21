<script setup lang="ts">
import { NavList, NavListGroup, NavListItem } from '@voice-room/ui/components';
import { useLocalizedText, currentErrorMessage } from '@/shared/i18n/localized-text';

import { t } from '@/shared/i18n';
import { Ban, SlidersHorizontal, Users } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import type { OwnedRoom } from '@/api/auth';
import { deleteRoom, updateRoom } from '@/api/rooms';
import ModerationCenter from '@/entities/room/components/ModerationCenter.vue';
import RoomAvatarField from '@/entities/room/components/RoomAvatarField.vue';
import RoomMemberList from '@/entities/room/components/RoomMemberList.vue';
import { saveRoomAvatarChange, type RoomAvatarChange } from '@/entities/room/room-avatar-change';
import { BAN_UNDO_DURATION_MS, type ModerationNoticeOptions } from '@/entities/room/room-moderation';
import { AlertDialog, Button, Dialog, Field, TextField } from '@voice-room/ui/components';
import { useToastsStore, type ToastOptions } from '../../model/toasts.store';

type Section = 'general' | 'members' | 'bans';

const props = defineProps<{ room: OwnedRoom | null }>();

const emit = defineEmits<{
  close: [];
  saved: [];
  deleted: [];
  toast: [message: string, options?: ToastOptions];
}>();

const { dismissToast } = useToastsStore();

const name = ref('');
const saving = ref(false);
const deleting = ref(false);
const confirmDelete = ref(false);
const error = useLocalizedText();
const deleteError = useLocalizedText();
const avatarChange = ref<RoomAvatarChange>({ kind: 'keep' });
const cropOpen = ref(false);
const section = ref<Section>('general');
// Save waits until the name or the picture actually changes.
const dirty = computed(
  () => Boolean(props.room) && (name.value.trim() !== (props.room?.name ?? '') || avatarChange.value.kind !== 'keep')
);

watch(
  () => props.room,
  (activeRoom) => {
    name.value = activeRoom?.name || '';
    error.value = '';
    confirmDelete.value = false;
    section.value = 'general';
    avatarChange.value = { kind: 'keep' };
    cropOpen.value = false;
  },
  { immediate: true }
);

async function save(): Promise<void> {
  const room = props.room;
  if (!room || saving.value || !name.value.trim()) return;
  saving.value = true;
  try {
    await updateRoom(room.roomId, { name: name.value.trim() });
    await saveRoomAvatarChange(room.roomId, avatarChange.value);
    emit('saved');
    emit('close');
    emit('toast', t('Комната обновлена'));
  } catch (cause) {
    error.value = () => (cause instanceof Error ? currentErrorMessage(cause) : t('Не удалось обновить комнату'));
  } finally {
    saving.value = false;
  }
}

async function remove(): Promise<void> {
  const room = props.room;
  if (!room || deleting.value) return;
  deleting.value = true;
  deleteError.value = '';
  try {
    await deleteRoom(room.roomId);
    emit('deleted');
    emit('close');
    emit('toast', t('Комната удалена'));
  } catch (cause) {
    deleteError.value = () => (cause instanceof Error ? currentErrorMessage(cause) : t('Не удалось удалить комнату'));
  } finally {
    deleting.value = false;
  }
}

function openDeleteConfirmation(): void {
  deleteError.value = '';
  confirmDelete.value = true;
}

function cancelDeleteConfirmation(): void {
  if (!deleting.value) confirmDelete.value = false;
}

function notifyModeration(message: string, options: ModerationNoticeOptions = {}): void {
  const undo = options.undo;
  emit('toast', message, {
    variant: options.variant,
    description: options.description,
    duration: undo ? BAN_UNDO_DURATION_MS : undefined,
    // The stack keeps a toast open after its action, so undo closes it first:
    // a second click would otherwise try to lift an already lifted ban.
    actions: undo
      ? [
          {
            label: undo.label,
            onClick: (toastId) => {
              dismissToast(toastId);
              undo.run();
            }
          }
        ]
      : undefined
  });
}

// A member menu open inside the dialog owns Escape: it closes the menu, not
// the whole dialog underneath it.
function hasOpenPopover(): boolean {
  return Boolean(document.querySelector('.popover-submenu__panel, .popover__panel--floating'));
}

function onClose(): void {
  if (cropOpen.value || hasOpenPopover()) return;
  emit('close');
}
</script>

<template>
  <Dialog :open="Boolean(room)" :title="t('Настройки комнаты')" size="lg" :on-close="onClose">
    <div v-if="room" class="room-settings">
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
          <RoomMemberList :room-id="room.roomId" can-moderate :on-notify="notifyModeration" />
        </div>
        <div v-else-if="section === 'bans'" class="settings__content room-settings__content">
          <ModerationCenter :room-id="room.roomId" :on-notify="notifyModeration" />
        </div>
        <form v-else class="settings__content room-settings__content" @submit.prevent="save">
          <p v-if="error" class="dialog__error" role="alert">{{ error }}</p>
          <div class="room-settings__profile-head">
            <RoomAvatarField
              :key="room.roomId"
              v-model:change="avatarChange"
              v-model:cropping="cropOpen"
              :saved-url="room.avatarUrl"
              :name="name || room.roomId"
              :disabled="saving || deleting"
              @error="(message: string) => (error = message)"
            />
            <Field class="room-settings__name-field" :label="t('Название')">
              <TextField v-model="name" maxlength="60" />
            </Field>
          </div>
          <div class="settings__actions">
            <button class="settings__cancel" type="button" @click="emit('close')">{{ t('Отмена') }}</button
            ><button class="settings__save" type="submit" :disabled="saving || !name.trim() || !dirty">
              {{ saving ? t('Сохраняем…') : t('Сохранить') }}
            </button>
          </div>
          <div class="dialog__danger-zone">
            <Button variant="danger-ghost" @click="openDeleteConfirmation">
              {{ t('Удалить комнату') }}
            </Button>
            <AlertDialog
              :open="confirmDelete"
              :title="t('Удалить комнату «{p0}»?', { p0: room.name || room.roomId })"
              :description="t('Комната будет удалена для всех участников. Это действие нельзя отменить.')"
              :confirm-label="deleting ? t('Удаляем…') : t('Удалить')"
              tone="danger"
              :busy="deleting"
              @cancel="cancelDeleteConfirmation"
              @confirm="remove"
            >
              <p v-if="deleteError" class="dialog__error" role="alert">{{ deleteError }}</p>
            </AlertDialog>
          </div>
        </form>
      </div>
    </div>
  </Dialog>
</template>
