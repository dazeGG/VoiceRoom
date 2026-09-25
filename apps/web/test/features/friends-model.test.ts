// The lobby's friends model: loading, live presence and relationships.

import { afterEach, expect, test, vi } from 'vitest';
import { stubFetch } from '../fixtures/fetch.ts';
import { notificationPreferences } from '../fixtures/users.ts';

type Handler = (event: { type: string; payload: Record<string, unknown> }) => void;
let emit: Handler = () => {};
vi.mock('../../src/lib/api/realtime', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  connectRealtime: (onEvent: Handler) => {
    emit = onEvent;
    return { close: vi.fn(), send: vi.fn() };
  }
}));

vi.mock('../../src/lib/features/room/client/media/cues', () => ({
  playDirectMessageCue: vi.fn(),
  playFriendAcceptedCue: vi.fn(),
  playFriendRequestCue: vi.fn(),
  playRingCue: vi.fn()
}));

const user = (id: string, login = id) => ({ id, login, displayName: login, avatarColorKey: 'blue', avatarUrl: null });

let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  stop = null;
});

async function startLobby() {
  stubFetch({
    '/api/friends': {
      body: {
        friends: [
          { user: user('anna'), online: true },
          { user: user('boris'), online: false }
        ],
        incomingRequestCount: 1
      }
    },
    '/api/friends/requests': { body: { incoming: [{ user: user('vera') }], outgoing: [{ user: user('gleb') }] } },
    '/api/notifications/preferences': { body: { preferences: notificationPreferences() } }
  });
  vi.resetModules();
  const friends = await import('../../src/lib/features/home/model/friends.svelte.ts');
  stop = friends.initLobby('me');
  await vi.waitFor(() => expect(friends.friendsState.loaded).toBe(true));
  return friends;
}

const onlineOf = (friends: Awaited<ReturnType<typeof startLobby>>, id: string) =>
  friends.friendsState.friends.find((friend) => friend.user.id === id)?.online;

test('the lobby loads friends and requests and knows each relationship', async () => {
  const friends = await startLobby();
  expect(friends.friendsState.friends.map((friend) => friend.user.id)).toEqual(['anna', 'boris']);
  expect(friends.friendsState.incomingRequestCount).toBe(1);
  await vi.waitFor(() => expect(friends.getFriendRelationship('vera')).toBe('incoming'));
  expect(friends.getFriendRelationship('anna')).toBe('friend');
  expect(friends.getFriendRelationship('gleb')).toBe('outgoing');
  expect(friends.getFriendRelationship('stranger')).toBe('none');
});

test('the realtime snapshot decides who is online, and presence events update it', async () => {
  const friends = await startLobby();
  emit({ type: 'ready', payload: { onlineFriendIds: ['boris'] } });
  expect(onlineOf(friends, 'anna')).toBe(false);
  expect(onlineOf(friends, 'boris')).toBe(true);

  emit({ type: 'friend.presence', payload: { userId: 'anna', online: true } });
  expect(onlineOf(friends, 'anna')).toBe(true);
});

test('a friend list refreshed after the snapshot keeps live presence for known friends', async () => {
  const friends = await startLobby();
  emit({ type: 'ready', payload: { onlineFriendIds: ['boris'] } });
  await friends.refreshFriends();
  // The HTTP result says anna online, boris offline; the live snapshot wins.
  expect(onlineOf(friends, 'anna')).toBe(false);
  expect(onlineOf(friends, 'boris')).toBe(true);
});

test('a new friend request and an accepted request each play their sound', async () => {
  await startLobby();
  const cues = await import('../../src/lib/features/room/client/media/cues');
  emit({ type: 'friend.request', payload: { request: { user: user('dima') } } });
  expect(cues.playFriendRequestCue).toHaveBeenCalledTimes(1);
  emit({ type: 'friend.accepted', payload: { friend: { user: user('dima'), online: true } } });
  expect(cues.playFriendAcceptedCue).toHaveBeenCalledTimes(1);
});
