import { defineStore } from 'pinia';
import { ref } from 'vue';
import { fetchMe, type AuthUser } from '@/api/auth';
import { clearChatDrafts, resumeChatDrafts } from '@/shared/chat/chat-drafts';
import { clearAttachmentComposeStores } from '@/shared/chat/attachment-compose-stores';
import { clearHistoryCache } from '@/shared/chat/history-cache';
import { displayNameOf } from '@/shared/utils/display-name';
import { DISPLAY_NAME_STORAGE_KEY } from '@/shared/storage';

// App-wide auth state. `loaded` flips true once the first /auth/me resolves so
// the UI can avoid flashing the logged-out state before we know.
export const useSessionStore = defineStore('session', () => {
  const loaded = ref(false);
  const user = ref<AuthUser | null>(null);

  let inflight: Promise<AuthUser | null> | null = null;

  // Set right before a request that ends this device's own session (sign-out,
  // password change): the server then closes the realtime socket too, and that
  // close must not read as the session being ended from another device.
  let sessionEndExpected = false;

  function expectSessionEnd(expected = true): void {
    sessionEndExpected = expected;
  }

  function consumeExpectedSessionEnd(): boolean {
    const expected = sessionEndExpected;
    sessionEndExpected = false;
    return expected;
  }

  // Mirror the account name into the room's local name key so voice rooms open
  // with the account's display name already filled in. This is not used as an
  // auth oracle; /auth/me remains the only source for logged-in state.
  function syncRoomName(next: AuthUser | null): void {
    if (typeof localStorage === 'undefined') return;
    try {
      if (next) {
        localStorage.setItem(DISPLAY_NAME_STORAGE_KEY, displayNameOf(next));
      } else {
        localStorage.removeItem(DISPLAY_NAME_STORAGE_KEY);
      }
    } catch {
      // Ignore storage failures (private mode, quota); the room falls back to a guest name.
    }
  }

  function setUser(next: AuthUser | null): void {
    sessionEndExpected = false;
    if (next) resumeChatDrafts();
    user.value = next;
    loaded.value = true;
    syncRoomName(next);
  }

  async function loadSession(force = false): Promise<AuthUser | null> {
    if (loaded.value && !force) return user.value;
    if (inflight) return inflight;

    inflight = fetchMe()
      .then((me) => {
        setUser(me);
        return me;
      })
      .catch((error: unknown) => {
        loaded.value = true;
        throw error;
      })
      .finally(() => {
        inflight = null;
      });

    return inflight;
  }

  function clearSession(): void {
    // The session ended on this device (sign-out, password change, deletion or a
    // revoked session): unsent texts must not outlive it on a shared computer.
    clearChatDrafts();
    clearAttachmentComposeStores();
    clearHistoryCache();
    user.value = null;
    loaded.value = true;
    syncRoomName(null);
  }

  return { loaded, user, expectSessionEnd, consumeExpectedSessionEnd, setUser, loadSession, clearSession };
});
