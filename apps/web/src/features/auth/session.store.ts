import { defineStore } from 'pinia';
import { onScopeDispose, ref } from 'vue';
import { fetchMe, type AuthUser } from '@/api/auth';
import { clearChatDrafts, resumeChatDrafts } from '@/shared/chat/chat-drafts';
import { clearAttachmentComposeStores } from '@/shared/chat/attachment-compose-stores';
import { clearHistoryCache } from '@/shared/chat/history-cache';
import { displayNameOf } from '@/shared/utils/display-name';
import { useRoomMembershipStore } from '@/entities/room/room-membership.store';
import { DISPLAY_NAME_STORAGE_KEY, writeStorage } from '@/shared/storage';

export const AUTH_INVALIDATION_KEY = 'voice-room:auth-invalidation';
export interface AuthContext {
  generation: number;
  userId: string | null;
}

function readInvalidationMarker(): string | null | undefined {
  try {
    return localStorage.getItem(AUTH_INVALIDATION_KEY);
  } catch {
    return undefined;
  }
}

// App-wide auth state. `loaded` flips true once the first /auth/me resolves so
// the UI can avoid flashing the logged-out state before we know.
export const useSessionStore = defineStore('session', () => {
  const loaded = ref(false);
  const loadError = ref(false);
  const user = ref<AuthUser | null>(null);

  const membership = useRoomMembershipStore();
  let generation = 0;
  let inflight: Promise<AuthUser | null> | null = null;
  let invalidationMarker = readInvalidationMarker();

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

  function context(): AuthContext {
    return { generation, userId: user.value?.id ?? null };
  }
  function isCurrent(captured: AuthContext): boolean {
    return captured.generation === generation && captured.userId === (user.value?.id ?? null);
  }
  function invalidate(): void {
    generation++;
    inflight = null;
    membership.resetViewer(null, generation);
  }
  function publishInvalidation(): void {
    const marker = crypto.randomUUID();
    writeStorage(AUTH_INVALIDATION_KEY, marker);
    invalidationMarker = marker;
  }

  function applyUser(next: AuthUser | null, publish: boolean): void {
    const changed = (user.value?.id ?? null) !== (next?.id ?? null);
    if (changed) {
      invalidate();
      membership.resetViewer(next?.id ?? null, generation);
      if (publish) publishInvalidation();
    }
    sessionEndExpected = false;
    if (next) resumeChatDrafts();
    user.value = next;
    loaded.value = true;
    loadError.value = false;
    syncRoomName(next);
  }

  // Explicit authentication may establish a different account.
  function setUser(next: AuthUser | null): void {
    applyUser(next, true);
  }

  function commitProfile(captured: AuthContext, next: AuthUser): boolean {
    if (!captured.userId || !isCurrent(captured) || next.id !== captured.userId) return false;
    const nativeVoice = next.nativeVoice ?? user.value?.nativeVoice;
    applyUser(nativeVoice ? { ...next, nativeVoice } : next, false);
    return true;
  }

  async function verifySession(): Promise<
    { applied: true; user: AuthUser | null; context: AuthContext } | { applied: false }
  > {
    const captured = context();
    const me = await fetchMe();
    if (!isCurrent(captured)) return { applied: false };
    applyUser(me, false);
    return { applied: true, user: me, context: context() };
  }

  async function loadSession(force = false, visibilityRefresh = false): Promise<AuthUser | null> {
    if (loaded.value && !force) return user.value;
    if (inflight) return inflight;
    loadError.value = false;
    const captured = context();
    const operation = verifySession()
      .then((result) => (result.applied && isCurrent(result.context) ? result.user : user.value))
      .catch((error: unknown) => {
        if (isCurrent(captured)) {
          if (visibilityRefresh) resetUnverifiedSession();
          loaded.value = true;
          loadError.value = true;
        }
        throw error;
      })
      .finally(() => {
        if (inflight === operation) inflight = null;
      });
    inflight = operation;
    return operation;
  }

  function resetUnverifiedSession(): void {
    invalidate();
    user.value = null;
    loaded.value = false;
    loadError.value = false;
    syncRoomName(null);
  }

  function revalidate(): void {
    resetUnverifiedSession();
    const captured = context();
    // Events carry no identity proof and must not echo another invalidation.
    void verifySession().catch(() => {
      if (!isCurrent(captured)) return;
      loaded.value = true;
      loadError.value = true;
    });
  }
  if (typeof window !== 'undefined') {
    let wasHidden = document.visibilityState === 'hidden';
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== AUTH_INVALIDATION_KEY || event.newValue === event.oldValue) return;
      invalidationMarker = readInvalidationMarker();
      revalidate();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') wasHidden = true;
      else if (wasHidden) {
        wasHidden = false;
        const marker = readInvalidationMarker();
        const needsReset = marker === undefined || marker !== invalidationMarker;
        invalidationMarker = marker;
        // With no sign of an identity change, keep the mounted room while
        // checking the cookie. A failed check still clears the old identity.
        if (needsReset || !loaded.value || loadError.value) revalidate();
        else void loadSession(true, true).catch(() => {});
      }
    };
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisibility);
    onScopeDispose(() => {
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisibility);
    });
  }

  function clearSession(): void {
    // The session ended on this device (sign-out, password change, deletion or a
    // revoked session): unsent texts must not outlive it on a shared computer.
    clearChatDrafts();
    clearAttachmentComposeStores();
    clearHistoryCache();
    invalidate();
    publishInvalidation();
    user.value = null;
    loaded.value = true;
    loadError.value = false;
    syncRoomName(null);
  }

  return {
    context,
    isCurrent,
    verifySession,
    commitProfile,
    loaded,
    loadError,
    user,
    expectSessionEnd,
    consumeExpectedSessionEnd,
    setUser,
    loadSession,
    clearSession
  };
});
