// The profile tab's unsaved edits: a new display name, and an avatar that is
// either a freshly cropped image or marked for removal. Nothing reaches the
// server until `save`, so closing the settings throws the edits away.

import { computed, ref } from 'vue';
import { deleteUserAvatar, updateDisplayName, uploadUserAvatar, type AuthUser } from '@/api/auth';
import { useSessionStore } from '@/features/auth/session.store';
import { syncLocalProfile } from '@/features/room/client';

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

export function useProfileDraft(user: AuthUser | null) {
  const name = ref(user?.displayName ?? '');
  /** The chosen file while the crop dialog is up. */
  const cropFile = ref<File | null>(null);
  /** The cropped image waiting to be uploaded, and its preview URL. */
  const pendingAvatar = ref<Blob | null>(null);
  const previewUrl = ref('');
  const removeAvatarPending = ref(false);
  const saving = ref(false);

  const cropOpen = computed(() => cropFile.value !== null);

  /** The avatar the tab shows: the new crop, nothing when removed, else the saved one. */
  function shownAvatar(current: AuthUser | null): string | null {
    if (previewUrl.value) return previewUrl.value;
    return removeAvatarPending.value ? null : current?.avatarUrl || null;
  }

  /** Starts cropping `file`, or says why it cannot be an avatar. */
  const pickFile = (file: File): string | null => {
    if (!file.type.startsWith('image/')) return 'Выберите изображение JPEG, PNG или WebP';
    if (file.size > AVATAR_MAX_BYTES) return 'Изображение должно быть меньше 5 МБ';
    cropFile.value = file;
    return null;
  };

  const cancelCrop = (): void => {
    cropFile.value = null;
  };

  const setAvatar = (blob: Blob): void => {
    revokePreview();
    pendingAvatar.value = blob;
    previewUrl.value = URL.createObjectURL(blob);
    removeAvatarPending.value = false;
    cropFile.value = null;
  };

  const removeAvatar = (): void => {
    revokePreview();
    pendingAvatar.value = null;
    removeAvatarPending.value = true;
  };

  const dispose = (): void => {
    revokePreview();
  };

  /**
   * Sends what changed: the name first, then the avatar. Answers false when
   * there was nothing to save; throws when the server refuses.
   */
  const save = async (current: AuthUser | null): Promise<boolean> => {
    if (saving.value) return false;
    // Snapshot before any await: the session update below changes `user`.
    const trimmedName = name.value.trim();
    const rename = trimmedName !== (current?.displayName ?? '');
    const avatar = pendingAvatar.value;
    const removeAvatarNow = removeAvatarPending.value;
    if (!rename && !avatar && !removeAvatarNow) return false;

    saving.value = true;
    try {
      const { setUser } = useSessionStore();
      if (rename) setUser(await updateDisplayName(trimmedName));
      if (avatar || removeAvatarNow) {
        const next = avatar ? await uploadUserAvatar(avatar) : await deleteUserAvatar();
        setUser(next);
        // The call tile of the local participant shows the new avatar without a rejoin.
        syncLocalProfile(next);
      }
      return true;
    } finally {
      saving.value = false;
    }
  };

  function revokePreview(): void {
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = '';
  }

  return {
    name,
    cropFile,
    pendingAvatar,
    previewUrl,
    removeAvatarPending,
    saving,
    cropOpen,
    shownAvatar,
    pickFile,
    cancelCrop,
    setAvatar,
    removeAvatar,
    dispose,
    save
  };
}
