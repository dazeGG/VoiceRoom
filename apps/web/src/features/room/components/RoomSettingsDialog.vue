<script setup lang="ts">
import { Ban, ChevronDown, SlidersHorizontal, Users } from '@lucide/vue';
import { Value } from 'typebox/value';
import { computed, ref, watch } from 'vue';
import { NotificationLevel } from '@voice-room/shared/contracts/notifications';
import { fetchRoomNotificationLevel, setRoomNotificationLevel, type RoomNotificationLevel } from '@/api/notifications';
import { deleteRoom, updateRoom } from '@/api/rooms';
import ModerationCenter from '@/entities/room/components/ModerationCenter.vue';
import RoomAvatarField from '@/entities/room/components/RoomAvatarField.vue';
import RoomMemberList from '@/entities/room/components/RoomMemberList.vue';
import { saveRoomAvatarChange, type RoomAvatarChange } from '@/entities/room/room-avatar-change';
import { BAN_UNDO_DURATION_MS, type ModerationNoticeOptions } from '@/entities/room/room-moderation';
import { Dialog } from '@/shared/ui';
import { iconMd, iconSm } from '@/shared/ui/icons';
import { state as roomClientState } from '../client/core/room-runtime.store';
import { applyRoomUpdated } from '../client/room/lifecycle';
import { showToast } from '../client/ui/toast';
import { useRoomSettingsStore } from '../room-settings.store';
import { useRoomShell } from '../shell';

type Section = 'general' | 'members' | 'bans';

const shell = useRoomShell();
const roomSettingsUi = useRoomSettingsStore();

const name = ref('');
const error = ref('');
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
    error.value = 'Дайте комнате название';
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
    showToast('Комната обновлена');
  } catch (err) {
    error.value = err instanceof Error && err.message ? err.message : 'Не удалось сохранить изменения';
  } finally {
    saving.value = false;
  }
}

async function confirmDelete(): Promise<void> {
  if (deleting.value) return;
  deleting.value = true;
  roomSettingsUi.deleting = true;
  try {
    await deleteRoom(roomClientState.roomId);
    window.location.href = '/';
  } catch (err) {
    deleting.value = false;
    roomSettingsUi.deleting = false;
    error.value = err instanceof Error && err.message ? err.message : 'Не удалось удалить комнату';
  }
}

async function saveNotificationLevel(event: Event): Promise<void> {
  const select = event.currentTarget;
  if (!(select instanceof HTMLSelectElement) || !Value.Check(NotificationLevel, select.value)) return;
  notificationLevel.value = select.value;
  notificationSaving.value = true;
  try {
    await setRoomNotificationLevel(roomClientState.roomId, notificationLevel.value);
  } catch (value) {
    error.value = value instanceof Error ? value.message : 'Не удалось сохранить уведомления';
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
  <Dialog :open="roomSettingsUi.open" title="Настройки комнаты" :width="780" :on-close="onClose">
    <div class="room-settings">
      <div class="settings__body settings__body--room">
        <nav class="settings__nav" aria-label="Разделы настроек комнаты">
          <div class="settings__nav-main">
            <button
              class="settings__nav-item"
              type="button"
              :aria-current="section === 'general' ? 'true' : undefined"
              @click="section = 'general'"
            >
              <SlidersHorizontal v-bind="iconMd" aria-hidden="true" />
              Основное
            </button>
            <button
              class="settings__nav-item"
              type="button"
              :aria-current="section === 'members' ? 'true' : undefined"
              @click="section = 'members'"
            >
              <Users v-bind="iconMd" aria-hidden="true" />
              Участники
            </button>
            <button
              class="settings__nav-item"
              type="button"
              :aria-current="section === 'bans' ? 'true' : undefined"
              @click="section = 'bans'"
            >
              <Ban v-bind="iconMd" aria-hidden="true" />
              Блокировки
            </button>
          </div>
        </nav>

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
            <label class="room-settings__name-field">
              <span class="settings__field-label">Название</span>
              <input v-model="name" class="settings__input" maxlength="60" placeholder="Название комнаты" />
            </label>
          </div>

          <label class="room-settings__notifications">
            <span class="settings__field-label">Уведомления комнаты</span>
            <span class="room-settings__select-wrap">
              <select
                class="room-settings__select"
                :value="notificationLevel"
                :disabled="notificationSaving"
                @change="saveNotificationLevel"
              >
                <option value="all">Все сообщения</option>
                <option value="mentions">Упоминания и ответы</option>
                <option value="none">Выключены</option>
              </select>
              <span class="room-settings__select-chevron" aria-hidden="true"><ChevronDown v-bind="iconSm" /></span>
            </span>
          </label>

          <div class="settings__actions">
            <button class="settings__cancel" type="button" @click="onCancel">Отмена</button>
            <button class="settings__save" type="submit" :disabled="saving || !dirty">
              <span v-if="saving" class="home-spinner" aria-hidden="true"></span>
              Сохранить
            </button>
          </div>

          <div class="dialog__danger-zone">
            <template v-if="confirmingDelete">
              <p class="dialog__danger-note">
                Комната будет удалена для всех участников. Это действие нельзя отменить.
              </p>
              <div class="dialog__danger-actions">
                <button class="settings__cancel" type="button" :disabled="deleting" @click="confirmingDelete = false">
                  Отмена
                </button>
                <button class="dialog__danger-confirm" type="button" :disabled="deleting" @click="confirmDelete">
                  <span v-if="deleting" class="home-spinner" aria-hidden="true"></span>
                  Удалить навсегда
                </button>
              </div>
            </template>
            <button v-else class="dialog__danger-trigger" type="button" @click="confirmingDelete = true">
              Удалить комнату
            </button>
          </div>
        </form>
      </div>
    </div>
  </Dialog>
</template>
