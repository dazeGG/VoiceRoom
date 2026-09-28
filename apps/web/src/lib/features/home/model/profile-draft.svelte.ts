// The profile tab's unsaved edits: a new display name, and an avatar that is
// either a freshly cropped image or marked for removal. Nothing reaches the
// server until `save`, so closing the settings throws the edits away.

import { deleteUserAvatar, updateDisplayName, uploadUserAvatar, type AuthUser } from '$lib/api/auth';
import { setUser } from '$lib/features/auth/session.svelte';
import { state as roomClientState } from '$lib/features/room/client/core/state.svelte';

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

export class ProfileDraft {
  name = $state('');
  /** The chosen file while the crop dialog is up. */
  cropFile = $state<File | null>(null);
  /** The cropped image waiting to be uploaded, and its preview URL. */
  pendingAvatar = $state<Blob | null>(null);
  previewUrl = $state('');
  removeAvatarPending = $state(false);
  saving = $state(false);

  constructor(user: AuthUser | null) {
    this.name = user?.displayName ?? '';
  }

  get cropOpen(): boolean {
    return this.cropFile !== null;
  }

  /** The avatar the tab shows: the new crop, nothing when removed, else the saved one. */
  shownAvatar(user: AuthUser | null): string | null {
    if (this.previewUrl) return this.previewUrl;
    return this.removeAvatarPending ? null : user?.avatarUrl || null;
  }

  /** Starts cropping `file`, or says why it cannot be an avatar. */
  pickFile = (file: File): string | null => {
    if (!file.type.startsWith('image/')) return 'Выберите изображение JPEG, PNG или WebP';
    if (file.size > AVATAR_MAX_BYTES) return 'Изображение должно быть меньше 5 МБ';
    this.cropFile = file;
    return null;
  };

  cancelCrop = (): void => {
    this.cropFile = null;
  };

  setAvatar = (blob: Blob): void => {
    this.#revokePreview();
    this.pendingAvatar = blob;
    this.previewUrl = URL.createObjectURL(blob);
    this.removeAvatarPending = false;
    this.cropFile = null;
  };

  removeAvatar = (): void => {
    this.#revokePreview();
    this.pendingAvatar = null;
    this.removeAvatarPending = true;
  };

  dispose = (): void => {
    this.#revokePreview();
  };

  /**
   * Sends what changed: the name first, then the avatar. Answers false when
   * there was nothing to save; throws when the server refuses.
   */
  save = async (user: AuthUser | null): Promise<boolean> => {
    if (this.saving) return false;
    // Snapshot before any await: the session update below changes `user`.
    const name = this.name.trim();
    const rename = name !== (user?.displayName ?? '');
    const avatar = this.pendingAvatar;
    const removeAvatar = this.removeAvatarPending;
    if (!rename && !avatar && !removeAvatar) return false;

    this.saving = true;
    try {
      if (rename) setUser(await updateDisplayName(name));
      if (avatar || removeAvatar) {
        const next = avatar ? await uploadUserAvatar(avatar) : await deleteUserAvatar();
        setUser(next);
        showAvatarInCall(next);
      }
      return true;
    } finally {
      this.saving = false;
    }
  };

  #revokePreview(): void {
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    this.previewUrl = '';
  }
}

// The call tile of the local participant shows the new avatar without a rejoin.
function showAvatarInCall(user: AuthUser): void {
  if (!roomClientState.self?.isLocal) return;
  roomClientState.self.avatarAccent = user.avatarAccent || '';
  roomClientState.self.avatarColorKey = user.avatarColorKey || '';
  roomClientState.self.avatarUrl = user.avatarUrl || '';
}
