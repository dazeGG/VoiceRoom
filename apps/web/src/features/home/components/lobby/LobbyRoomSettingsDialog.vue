<script setup lang="ts">
import { Ban, SlidersHorizontal, Users } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import type { OwnedRoom } from '@/api/auth';
import { deleteRoom, updateRoom } from '@/api/rooms';
import ModerationCenter from '@/entities/room/components/ModerationCenter.vue';
import RoomAvatarField from '@/entities/room/components/RoomAvatarField.vue';
import RoomMemberList from '@/entities/room/components/RoomMemberList.vue';
import { saveRoomAvatarChange, type RoomAvatarChange } from '@/entities/room/room-avatar-change';
import { BAN_UNDO_DURATION_MS, type ModerationNoticeOptions } from '@/entities/room/room-moderation';
import { Dialog } from '@/shared/ui';
import { iconMd } from '@/shared/ui/icons';
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
const error = ref('');
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
    emit('toast', 'Комната обновлена');
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось обновить комнату';
  } finally {
    saving.value = false;
  }
}

async function remove(): Promise<void> {
  const room = props.room;
  if (!room || deleting.value) return;
  deleting.value = true;
  try {
    await deleteRoom(room.roomId);
    emit('deleted');
    emit('close');
    emit('toast', 'Комната удалена');
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось удалить комнату';
    deleting.value = false;
  }
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
  <Dialog :open="Boolean(room)" title="Настройки комнаты" :width="780" :on-close="onClose">
    <div v-if="room" class="room-settings">
      <div class="settings__body settings__body--room">
        <nav class="settings__nav" aria-label="Разделы настроек комнаты">
          <div class="settings__nav-main">
            <button
              class="settings__nav-item"
              type="button"
              :aria-current="section === 'general' ? 'true' : undefined"
              @click="section = 'general'"
            >
              <SlidersHorizontal v-bind="iconMd" aria-hidden="true" />Основное
            </button>
            <button
              class="settings__nav-item"
              type="button"
              :aria-current="section === 'members' ? 'true' : undefined"
              @click="section = 'members'"
            >
              <Users v-bind="iconMd" aria-hidden="true" />Участники
            </button>
            <button
              class="settings__nav-item"
              type="button"
              :aria-current="section === 'bans' ? 'true' : undefined"
              @click="section = 'bans'"
            >
              <Ban v-bind="iconMd" aria-hidden="true" />Блокировки
            </button>
          </div>
        </nav>

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
            <label class="room-settings__name-field"
              ><span class="settings__field-label">Название</span
              ><input v-model="name" class="settings__input" maxlength="60"
            /></label>
          </div>
          <div class="settings__actions">
            <button class="settings__cancel" type="button" @click="emit('close')">Отмена</button
            ><button class="settings__save" type="submit" :disabled="saving || !name.trim() || !dirty">
              {{ saving ? 'Сохраняем…' : 'Сохранить' }}
            </button>
          </div>
          <div class="dialog__danger-zone">
            <template v-if="confirmDelete">
              <p class="dialog__danger-note">Комната будет удалена для всех участников.</p>
              <div class="dialog__danger-actions">
                <button class="settings__cancel" type="button" @click="confirmDelete = false">Отмена</button
                ><button class="dialog__danger-confirm" type="button" :disabled="deleting" @click="remove">
                  Удалить навсегда
                </button>
              </div>
            </template>
            <button v-else class="dialog__danger-trigger" type="button" @click="confirmDelete = true">
              Удалить комнату
            </button>
          </div>
        </form>
      </div>
    </div>
  </Dialog>
</template>
