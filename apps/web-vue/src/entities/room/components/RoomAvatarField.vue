<script setup lang="ts">
// The room avatar in room settings: the avatar opens a file picker and a crop
// dialog, a corner button removes it, and nothing reaches the server until the
// settings are saved. Mount it per opening (and per room) to start from what
// is saved.
import { Camera, X } from '@lucide/vue';
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue';
import { Avatar, AvatarCropDialog } from '@/shared/ui';
import { iconSm } from '@/shared/ui/icons';
import type { RoomAvatarChange } from '../room-avatar-change';

// Two roots (the field and the crop dialog): attributes go to the field.
defineOptions({ inheritAttrs: false });

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const props = withDefaults(
  defineProps<{
    /** The room's saved avatar, or null. */
    savedUrl: string | null;
    /** Shown as initials without an avatar and named in the crop dialog. */
    name: string;
    disabled?: boolean;
  }>(),
  { disabled: false }
);

const emit = defineEmits<{ error: [message: string] }>();

const change = defineModel<RoomAvatarChange>('change', { default: () => ({ kind: 'keep' }) });
/** The crop dialog is up: it owns Escape and focus until it closes. */
const cropping = defineModel<boolean>('cropping', { default: false });

const input = ref<HTMLInputElement | null>(null);
const file = shallowRef<File | null>(null);
const previewUrl = ref('');

const shownUrl = computed(() =>
  change.value.kind === 'upload' ? previewUrl.value : change.value.kind === 'remove' ? null : props.savedUrl
);
const editLabel = computed(() => (shownUrl.value ? 'Изменить аватар комнаты' : 'Загрузить аватар комнаты'));

onBeforeUnmount(() => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
});

function pick(event: Event): void {
  const target = event.currentTarget;
  if (!(target instanceof HTMLInputElement)) return;
  const selected = target.files?.[0] ?? null;
  target.value = '';
  if (!selected) return;
  if (!selected.type.startsWith('image/')) {
    emit('error', 'Выберите изображение JPEG, PNG или WebP');
    return;
  }
  if (selected.size > MAX_IMAGE_BYTES) {
    emit('error', 'Изображение должно быть меньше 5 МБ');
    return;
  }
  file.value = selected;
  cropping.value = true;
}

async function cropped(image: Blob): Promise<void> {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = URL.createObjectURL(image);
  change.value = { kind: 'upload', image };
  cropping.value = false;
  file.value = null;
}

function remove(): void {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = '';
  change.value = { kind: 'remove' };
}

function closeCrop(): void {
  cropping.value = false;
  file.value = null;
}
</script>

<template>
  <div class="room-avatar-field" v-bind="$attrs">
    <input
      ref="input"
      class="room-avatar-field__input"
      type="file"
      accept="image/jpeg,image/png,image/webp"
      @change="pick"
    />
    <button
      class="room-avatar-field__edit"
      type="button"
      :disabled="disabled"
      :aria-label="editLabel"
      :title="editLabel"
      @click="input?.click()"
    >
      <Avatar :name="name" :src="shownUrl" shape="squircle" background="var(--vr-surface-3)" :size="76" />
    </button>
    <span class="room-avatar-field__camera" aria-hidden="true"><Camera v-bind="iconSm" /></span>
    <button
      v-if="shownUrl"
      class="room-avatar-field__remove"
      type="button"
      :disabled="disabled"
      aria-label="Удалить аватар комнаты"
      title="Удалить аватар комнаты"
      @click="remove"
    >
      <X v-bind="iconSm" aria-hidden="true" />
    </button>
  </div>

  <AvatarCropDialog
    :open="cropping"
    :file="file"
    :name="name"
    shape="squircle"
    kind="room"
    title="Аватар комнаты"
    :on-close="closeCrop"
    :on-save="cropped"
  />
</template>
