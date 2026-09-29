// Friend presence: the realtime snapshot wins over a friends fetch, a friend
// the snapshot never heard of takes the fetch's flag, and live events update.

import { expect, test } from 'vitest';
import { FriendPresence } from '../../src/lib/features/home/model/friend-presence.svelte';

test('before a snapshot every friend keeps the flag the fetch gave', () => {
  const presence = new FriendPresence();
  expect(presence.ready).toBe(false);
  expect(presence.onlineOr('ada', true)).toBe(true);
  presence.seed([{ userId: 'ada', online: false }]);
  expect(presence.onlineOr('ada', true)).toBe(true);
});

test('the snapshot decides for known friends; a new friend is seeded from the fetch', () => {
  const presence = new FriendPresence();
  presence.snapshot(['ada'], ['ada', 'bob']);

  expect(presence.onlineOr('ada', false)).toBe(true);
  expect(presence.onlineOr('bob', true)).toBe(false);

  presence.seed([
    { userId: 'bob', online: true },
    { userId: 'cid', online: true }
  ]);
  expect(presence.onlineOr('bob', true)).toBe(false);
  expect(presence.onlineOr('cid', false)).toBe(true);

  presence.set('bob', true);
  presence.set('ada', false);
  expect(presence.onlineOr('bob')).toBe(true);
  expect(presence.onlineOr('ada')).toBe(false);

  presence.reset();
  expect(presence.ready).toBe(false);
  expect(presence.onlineOr('bob', false)).toBe(false);
});
