<script setup lang="ts">
import { Field, IconButton, Spinner, SettingRow, SettingsGroup, TextField, Tooltip } from '@voice-room/ui/components';
import { t } from '@/shared/i18n';
import { Pencil, X } from '@lucide/vue';
import { computed, ref, type UnwrapNestedRefs } from 'vue';
import type { AuthUser } from '@/api/auth';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { Avatar, AvatarCropDialog } from '@/shared/ui';
import { iconSm } from '@/shared/ui/icons';
import { displayNameOf } from '@/shared/utils/display-name';
import type { useProfileDraft } from '../../model/use-profile-draft';
import type { ToastOptions } from '../../model/toasts.store';

const props = defineProps<{
  user: AuthUser | null;
  /** Kept by the settings dialog, so the edits survive a look at another tab. */
  draft: UnwrapNestedRefs<ReturnType<typeof useProfileDraft>>;
}>();

/** The display name being edited; the draft above owns it. */
const name = defineModel<string>('name', { required: true });

const emit = defineEmits<{
  close: [];
  toast: [message: string, options?: ToastOptions];
}>();

const avatarInput = ref<HTMLInputElement>();

const label = computed(() => (props.user ? displayNameOf(props.user) : ''));
const avatarSrc = computed(() => props.draft.shownAvatar(props.user));
const avatarAction = computed(() => (props.user?.avatarUrl ? t('Изменить аватар') : t('Загрузить аватар')));

function onAvatarFile(event: Event): void {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) return;
  const selected = input.files?.[0] ?? null;
  input.value = '';
  if (!selected) return;
  const problem = props.draft.pickFile(selected);
  if (problem) emit('toast', problem);
}

async function save(): Promise<void> {
  try {
    if (await props.draft.save(props.user)) emit('toast', t('Изменения сохранены'));
    emit('close');
  } catch (error) {
    emit('toast', error instanceof Error && error.message ? error.message : t('Не удалось сохранить'));
  }
}
</script>

<template>
  <SettingsGroup>
    <SettingRow :description="user?.login ? '@' + user.login : ''">
      <template #leading
        ><div class="settings__avatar-control">
          <input
            ref="avatarInput"
            class="settings__avatar-input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            @change="onAvatarFile"
          />
          <Tooltip :text="avatarAction">
            <button
              type="button"
              class="settings__avatar-edit"
              :aria-label="avatarAction"
              @click="avatarInput?.click()"
            >
              <Avatar
                :name="label"
                :src="avatarSrc"
                :color-key="user?.avatarColorKey"
                :background="user?.avatarAccent || undefined"
                :size="56"
              />
              <span class="settings__avatar-overlay" aria-hidden="true">
                <Pencil v-bind="iconSm" />
              </span>
            </button>
          </Tooltip>
          <IconButton
            v-if="avatarSrc"
            class="settings__avatar-remove"
            :size="24"
            variant="danger"
            :label="t('Удалить аватар')"
            @click="draft.removeAvatar"
          >
            <X aria-hidden="true" />
          </IconButton></div
      ></template>
      <template #title><EmojiText :text="label" /></template>
    </SettingRow>
    <SettingRow>
      <template #title>
        <Field :label="t('Имя')">
          <TextField v-model="name" maxlength="40" autocomplete="nickname" />
        </Field>
      </template>
    </SettingRow>
  </SettingsGroup>

  <div class="settings__actions">
    <button class="settings__cancel" type="button" :disabled="draft.saving" @click="emit('close')">
      {{ t('Отмена') }}
    </button>
    <button class="settings__save" type="button" :disabled="draft.saving" @click="save">
      <Spinner v-if="draft.saving" aria-hidden="true" /> {{ t('Сохранить') }}
    </button>
  </div>

  <AvatarCropDialog
    :open="draft.cropOpen"
    :file="draft.cropFile"
    :name="label"
    shape="circle"
    kind="user"
    :title="t('Аватар профиля')"
    :on-close="draft.cancelCrop"
    :on-save="async (blob: Blob) => draft.setAvatar(blob)"
  />
</template>
