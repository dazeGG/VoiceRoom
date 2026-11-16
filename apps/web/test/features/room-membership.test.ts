import { createPinia, disposePinia, setActivePinia, type Pinia } from 'pinia';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { fetchRoomMemberships, leaveRoomMembership } from '@/api/memberships';
import { useRoomMembershipStore } from '@/entities/room/room-membership.store';
import { useSessionStore } from '@/features/auth/session.store';
import { authUser } from '../fixtures/users';
import { member } from '../fixtures/answers';

vi.mock('@/api/memberships', () => ({ fetchRoomMemberships: vi.fn(), leaveRoomMembership: vi.fn() }));
let pinia: Pinia;
beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  pinia = createPinia();
  setActivePinia(pinia);
});
afterEach(() => {
  disposePinia(pinia);
  vi.restoreAllMocks();
});
const A = authUser();
const B = authUser({ id: '22222222-2222-4222-8222-222222222222' });
const key = (id = A.id) => `voice-room:membership:v2:${encodeURIComponent(id)}:room`;
const envelope = (name = 'A') => ({
  contractVersion: 1 as const,
  roomId: 'room',
  members: [member({ displayName: name })],
  pageInfo: { hasMore: false },
  presenceRevision: 1
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  const session = useSessionStore();
  session.setUser(A);
  return { session, store: useRoomMembershipStore() };
}

test('legacy purge, unresolved isolation, viewer-bound envelope and logout purge', async () => {
  localStorage.setItem('voice-room:membership:v1:room', JSON.stringify(envelope()));
  localStorage.setItem(key(), JSON.stringify({ viewerId: A.id, ...envelope() }));
  localStorage.setItem(key(B.id), JSON.stringify({ viewerId: B.id, ...envelope('B') }));
  const store = useRoomMembershipStore();
  expect(localStorage.getItem('voice-room:membership:v1:room')).toBeNull();
  expect(store.getRoomMembership('room').members).toEqual([]);
  await store.loadRoomMembership('room');
  expect(fetchRoomMemberships).not.toHaveBeenCalled();
  const session = useSessionStore();
  session.setUser(A);
  expect(store.getRoomMembership('room').members[0]?.displayName).toBe('A');
  session.setUser(B);
  expect(localStorage.getItem(key())).toBeNull();
  expect(store.getRoomMembership('room').members[0]?.displayName).toBe('B');
  session.clearSession();
  expect(store.roomMemberTotal('room')).toBe(0);
  expect(localStorage.getItem(key(B.id))).toBeNull();
});

test('a mismatched viewer envelope is never read', () => {
  localStorage.setItem(key(), JSON.stringify({ viewerId: B.id, ...envelope() }));
  const { store } = setup();
  expect(store.getRoomMembership('room').members).toEqual([]);
});

for (const status of [401, 403, 404, 400, 0, 500, 503])
  test(`status ${status} permits fallback only for a transient failure`, async () => {
    const { store } = setup();
    vi.mocked(fetchRoomMemberships).mockResolvedValueOnce(envelope());
    await store.loadRoomMembership('room');
    vi.mocked(fetchRoomMemberships).mockRejectedValueOnce(new ApiError('failure', status));
    await store.loadRoomMembership('room');
    const transient = status === 0 || status >= 500;
    expect(store.getRoomMembership('room').members.length).toBe(transient ? 1 : 0);
    expect(store.getRoomMembership('room').cachedMembers.length).toBe(transient ? 1 : 0);
    expect(store.getRoomMembership('room').error).toBeTruthy();
    expect(localStorage.getItem(key()) !== null).toBe(transient);
  });

for (const append of [false, true])
  for (const transition of ['switch', 'logout', 'clear'] as const)
    test(`obsolete ${append ? 'append' : 'load'} after ${transition} cannot write or finish a new entry`, async () => {
      const { store, session } = setup();
      const old = deferred<ReturnType<typeof envelope>>();
      const fresh = deferred<ReturnType<typeof envelope>>();
      vi.mocked(fetchRoomMemberships).mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
      const pending = store.loadRoomMembership('room', { append });
      if (transition === 'switch') session.setUser(B);
      else if (transition === 'logout') {
        session.clearSession();
        session.setUser(B);
      } else store.clearRoomMembership('room');
      const next = store.loadRoomMembership('room');
      old.resolve(envelope('OLD'));
      await pending;
      expect(store.getRoomMembership('room').loading).toBe(true);
      expect(store.getRoomMembership('room').members).toEqual([]);
      fresh.resolve(envelope('NEW'));
      await next;
      expect(store.getRoomMembership('room').members[0]?.displayName).toBe('NEW');
      expect(JSON.stringify(localStorage)).not.toContain('OLD');
    });

test('late leave cannot remove the next viewer entry', async () => {
  const { store, session } = setup();
  const old = deferred<{ left: boolean; ok: true }>();
  vi.mocked(leaveRoomMembership).mockReturnValueOnce(old.promise);
  const leaving = store.leaveActiveRoomMembership('room');
  session.setUser(B);
  vi.mocked(fetchRoomMemberships).mockResolvedValueOnce(envelope('B'));
  await store.loadRoomMembership('room');
  old.resolve({ ok: true, left: true });
  expect(await leaving).toBe(false);
  expect(store.getRoomMembership('room').members[0]?.displayName).toBe('B');
});

test('successful leave invalidates a refresh started while leave was pending', async () => {
  const { store } = setup();
  vi.mocked(fetchRoomMemberships).mockResolvedValueOnce(envelope());
  await store.loadRoomMembership('room');
  const leave = deferred<{ left: boolean; ok: true }>();
  const read = deferred<ReturnType<typeof envelope>>();
  vi.mocked(leaveRoomMembership).mockReturnValueOnce(leave.promise);
  vi.mocked(fetchRoomMemberships).mockReturnValueOnce(read.promise);
  const leaving = store.leaveActiveRoomMembership('room');
  const loading = store.loadRoomMembership('room');
  leave.resolve({ ok: true, left: true });
  expect(await leaving).toBe(true);
  read.resolve(envelope('OBSOLETE'));
  await loading;
  expect(store.byRoomId).toEqual({});
  expect(localStorage.getItem(key())).toBeNull();
});

test('storage denial preserves in-memory isolation', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('denied');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('denied');
  });
  const { store, session } = setup();
  vi.mocked(fetchRoomMemberships).mockResolvedValueOnce(envelope());
  await store.loadRoomMembership('room');
  session.setUser(B);
  expect(store.getRoomMembership('room').members).toEqual([]);
});

test('query pagination merges same-viewer pages without replacing the cached directory', async () => {
  const { store } = setup();
  vi.mocked(fetchRoomMemberships).mockResolvedValueOnce({
    ...envelope(),
    pageInfo: { hasMore: true, nextCursor: 'next' }
  });
  await store.loadRoomMembership('room');
  vi.mocked(fetchRoomMemberships).mockResolvedValueOnce({
    ...envelope('B'),
    members: [member({ userId: B.id, displayName: 'B' })]
  });
  await store.loadRoomMembership('room', { append: true });
  expect(fetchRoomMemberships).toHaveBeenLastCalledWith('room', { cursor: 'next', query: '' });
  expect(store.getRoomMembership('room').members).toHaveLength(2);
  vi.mocked(fetchRoomMemberships).mockResolvedValueOnce(envelope('filtered'));
  await store.loadRoomMembership('room', { query: 'filtered' });
  expect(store.getRoomMembership('room').cachedMembers).toHaveLength(2);
});
