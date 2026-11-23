import { installWebCallPortsForTest } from '../helpers/call-ports';
import { createPinia, disposePinia, setActivePinia, type Pinia } from 'pinia';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  fetchMe,
  updateDisplayName,
  uploadUserAvatar,
  deleteUserAvatar,
  addRoomByCode,
  fetchOwnedRooms,
  type AuthUser
} from '@/api/auth';
import { AUTH_INVALIDATION_KEY, useSessionStore } from '@/features/auth/session.store';
import { useRoomMembershipStore } from '@/entities/room/room-membership.store';
import { useProfileDraft } from '@/features/home/model/use-profile-draft';
import { syncLocalProfile } from '@voiceroom/call/engine';
import { resolveRoomEntryName } from '@voiceroom/call/engine/room/room-entry';
import { state } from '@voiceroom/call/engine/core/room-runtime.store';
import { persistName, requestGuestNameForRoom } from '@voiceroom/call/engine/ui/names';
import { useRoomSettingsStore } from '@/features/room/room-settings.store';
import { authUser } from '../fixtures/users';

vi.mock('@/api/auth', async (original) => ({
  ...(await original<object>()),
  fetchMe: vi.fn(),
  updateDisplayName: vi.fn(),
  uploadUserAvatar: vi.fn(),
  deleteUserAvatar: vi.fn(),
  addRoomByCode: vi.fn(),
  fetchOwnedRooms: vi.fn()
}));
vi.mock('@voiceroom/call/engine', () => ({ syncLocalProfile: vi.fn() }));
vi.mock('@voiceroom/call/engine/ui/names', () => ({ persistName: vi.fn(), requestGuestNameForRoom: vi.fn() }));
vi.mock('@voiceroom/call/engine/ui/toast', () => ({ showToast: vi.fn() }));
vi.mock('@voiceroom/call/engine/core/embed', () => ({ getRoomShell: () => shell, isRoomEmbedded: () => false }));
const shell = vi.hoisted(() => ({ roomsChanged: vi.fn() }));
let pinia: Pinia;
const A = authUser();
const B = authUser({ id: '22222222-2222-4222-8222-222222222222', displayName: 'B' });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(async () => {
  vi.resetAllMocks();
  localStorage.clear();
  pinia = createPinia();
  setActivePinia(pinia);
  await installWebCallPortsForTest();
  state.roomId = 'room';
  state.roomIsStatic = true;
});
afterEach(() => {
  disposePinia(pinia);
  vi.restoreAllMocks();
});
function transition(kind: string) {
  const session = useSessionStore();
  if (kind === 'switch') session.setUser(B);
  else if (kind === 'logout') session.clearSession();
  else {
    vi.mocked(fetchMe).mockReturnValueOnce(new Promise(() => {}));
    window.dispatchEvent(new StorageEvent('storage', { key: AUTH_INVALIDATION_KEY, newValue: 'nonce' }));
  }
}

for (const kind of ['switch', 'logout', 'invalidation']) {
  test(`old session refresh after ${kind} cannot restore identity or clear a newer inflight`, async () => {
    const session = useSessionStore();
    session.setUser(A);
    const old = deferred<AuthUser | null>();
    const fresh = deferred<AuthUser | null>();
    vi.mocked(fetchMe).mockReturnValueOnce(old.promise);
    const pending = session.loadSession(true);
    transition(kind);
    vi.mocked(fetchMe).mockReturnValueOnce(fresh.promise);
    const next = session.loadSession(true);
    old.resolve(A);
    await pending;
    const calls = vi.mocked(fetchMe).mock.calls.length;
    const same = session.loadSession(true);
    expect(fetchMe).toHaveBeenCalledTimes(calls);
    fresh.resolve(B);
    await Promise.all([next, same]);
    expect(session.user?.id).toBe(B.id);
  });
  test(`direct room verification after ${kind} fails without downstream account work`, async () => {
    const session = useSessionStore();
    session.setUser(A);
    const old = deferred<AuthUser | null>();
    vi.mocked(fetchMe).mockReturnValueOnce(old.promise);
    const entering = resolveRoomEntryName();
    transition(kind);
    old.resolve(A);
    expect(await entering).toBe('failure');
    expect(persistName).not.toHaveBeenCalled();
    expect(addRoomByCode).not.toHaveBeenCalled();
    expect(fetchOwnedRooms).not.toHaveBeenCalled();
    expect(requestGuestNameForRoom).not.toHaveBeenCalled();
  });
  for (const action of ['rename', 'upload', 'delete'])
    test(`obsolete ${action} after ${kind} cannot update or continue the profile save`, async () => {
      const session = useSessionStore();
      session.setUser(A);
      const draft = useProfileDraft(A);
      const old = deferred<AuthUser>();
      if (action === 'rename') {
        draft.name.value = 'Renamed';
        draft.removeAvatar();
        vi.mocked(updateDisplayName).mockReturnValueOnce(old.promise);
      } else if (action === 'upload') {
        draft.pendingAvatar.value = new Blob(['avatar']);
        vi.mocked(uploadUserAvatar).mockReturnValueOnce(old.promise);
      } else {
        draft.removeAvatar();
        vi.mocked(deleteUserAvatar).mockReturnValueOnce(old.promise);
      }
      const saving = draft.save(A);
      transition(kind);
      old.resolve({ ...A, displayName: 'OLD' });
      expect(await saving).toBe(false);
      expect(session.user?.displayName).not.toBe('OLD');
      expect(syncLocalProfile).not.toHaveBeenCalled();
      if (action === 'rename') expect(deleteUserAvatar).not.toHaveBeenCalled();
      expect(draft.saving.value).toBe(false);
    });
}

test('post-commit refresh context accepts initial unresolved to A and stale room callbacks stay silent', async () => {
  vi.mocked(fetchMe).mockResolvedValueOnce(A);
  const bookmark = deferred<Awaited<ReturnType<typeof addRoomByCode>>>();
  const owned = deferred<Awaited<ReturnType<typeof fetchOwnedRooms>>>();
  vi.mocked(addRoomByCode).mockReturnValueOnce(bookmark.promise);
  vi.mocked(fetchOwnedRooms).mockReturnValueOnce(owned.promise);
  expect(await resolveRoomEntryName()).toBe('authenticated');
  expect(persistName).toHaveBeenCalled();
  useSessionStore().setUser(B);
  bookmark.resolve({
    roomId: 'room',
    name: 'Room',
    isStatic: true,
    avatarUrl: null,
    createdAt: 1,
    peers: 0,
    relationship: 'member'
  });
  owned.resolve([
    { roomId: 'room', name: 'Room', isStatic: true, avatarUrl: null, createdAt: 1, peers: 0, relationship: 'owner' }
  ]);
  await Promise.resolve();
  await Promise.resolve();
  expect(shell.roomsChanged).not.toHaveBeenCalled();
  expect(useRoomSettingsStore().isOwner).toBe(false);
});

test('same-account profile commit retains membership while mismatched profile identity is rejected', async () => {
  const session = useSessionStore();
  session.setUser(A);
  const store = useRoomMembershipStore();
  const entry = store.getRoomMembership('room');
  const captured = session.context();
  const draft = useProfileDraft(A);
  draft.name.value = 'New';
  vi.mocked(updateDisplayName).mockResolvedValueOnce({ ...A, displayName: 'New' });
  expect(await draft.save(A)).toBe(true);
  expect(session.isCurrent(captured)).toBe(true);
  expect(store.getRoomMembership('room')).toBe(entry);
  expect(session.commitProfile(captured, B)).toBe(false);
  session.setUser(B);
  expect(session.user?.id).toBe(B.id);
});

test('visibility return clears immediately even when browser storage is unavailable', async () => {
  const session = useSessionStore();
  session.setUser(A);
  const old = deferred<AuthUser | null>();
  vi.mocked(fetchMe).mockReturnValueOnce(old.promise);
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('denied');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('denied');
  });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  document.dispatchEvent(new Event('visibilitychange'));
  expect(session.user).toBeNull();
  expect(useRoomMembershipStore().byRoomId).toEqual({});
  old.resolve(B);
  await vi.waitFor(() => expect(session.user?.id).toBe(B.id));
});

test('visibility return clears immediately when the invalidation marker changed while hidden', async () => {
  const session = useSessionStore();
  session.setUser(A);
  const response = deferred<AuthUser | null>();
  vi.mocked(fetchMe).mockReturnValueOnce(response.promise);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  localStorage.setItem(AUTH_INVALIDATION_KEY, 'new-account-in-another-tab');
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  document.dispatchEvent(new Event('visibilitychange'));
  expect(session.user).toBeNull();
  response.resolve(B);
  await vi.waitFor(() => expect(session.user?.id).toBe(B.id));
});

for (const trigger of ['storage', 'visibility']) {
  test(`${trigger} revalidation failure settles loading and allows a fresh retry`, async () => {
    const session = useSessionStore();
    session.setUser(A);
    vi.mocked(fetchMe).mockRejectedValueOnce(new Error('offline'));
    if (trigger === 'storage') {
      window.dispatchEvent(new StorageEvent('storage', { key: AUTH_INVALIDATION_KEY, newValue: 'failed' }));
    } else {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
    }
    await vi.waitFor(() => expect(session.loadError).toBe(true));
    expect(session.loaded).toBe(true);
    expect(session.user).toBeNull();
    expect(useRoomMembershipStore().byRoomId).toEqual({});
    vi.mocked(fetchMe).mockResolvedValueOnce(B);
    await session.loadSession(true);
    expect(session.loadError).toBe(false);
    expect(session.user?.id).toBe(B.id);
  });
}

test('an obsolete revalidation failure cannot replace a newer successful identity with an error', async () => {
  const failed = Promise.withResolvers<AuthUser | null>();
  const session = useSessionStore();
  session.setUser(A);
  vi.mocked(fetchMe).mockReturnValueOnce(failed.promise);
  window.dispatchEvent(new StorageEvent('storage', { key: AUTH_INVALIDATION_KEY, newValue: 'old' }));
  session.setUser(B);
  failed.reject(new Error('late failure'));
  await Promise.resolve();
  await Promise.resolve();
  expect(session.user?.id).toBe(B.id);
  expect(session.loadError).toBe(false);
  expect(session.loaded).toBe(true);
});

test('loadSession rechecks an accepted context before returning its account', async () => {
  const session = useSessionStore();
  const response = deferred<AuthUser | null>();
  vi.mocked(fetchMe).mockReturnValueOnce(response.promise);
  const loading = session.loadSession();
  const switching = response.promise.then(() => session.setUser(B));
  response.resolve(A);
  expect((await loading)?.id).toBe(B.id);
  await switching;
});

test('a guest verification superseded after commit cannot start a name prompt', async () => {
  const response = deferred<AuthUser | null>();
  vi.mocked(fetchMe).mockReturnValueOnce(response.promise);
  const entering = resolveRoomEntryName();
  const switching = response.promise.then(() => useSessionStore().setUser(B));
  response.resolve(null);
  expect(await entering).toBe('failure');
  await switching;
  expect(requestGuestNameForRoom).not.toHaveBeenCalled();
});

test('a guest-name completion after authentication cannot admit the obsolete guest', async () => {
  const name = deferred<string>();
  vi.mocked(fetchMe).mockResolvedValueOnce(null);
  vi.mocked(requestGuestNameForRoom).mockReturnValueOnce(name.promise);
  const entering = resolveRoomEntryName();
  await vi.waitFor(() => expect(requestGuestNameForRoom).toHaveBeenCalled());
  useSessionStore().setUser(B);
  name.resolve('Guest');
  expect(await entering).toBe('failure');
});
