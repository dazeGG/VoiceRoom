// Friend presence: the realtime snapshot wins over a friends fetch, a friend
// the snapshot never heard of takes the fetch's flag, and live events update.

import { expect, test } from 'vitest';
import { useFriendPresence } from '../../src/features/home/model/use-friend-presence.ts';

test('before a snapshot every friend keeps the flag the fetch gave', () => {
  const presence = useFriendPresence();
  expect(presence.ready.value).toBe(false);
  expect(presence.onlineOr('ada', true)).toBe(true);
  presence.seed([{ userId: 'ada', online: false }]);
  expect(presence.onlineOr('ada', true)).toBe(true);
});

test('the snapshot decides for known friends; a new friend is seeded from the fetch', () => {
  const presence = useFriendPresence();
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
  expect(presence.ready.value).toBe(false);
  expect(presence.onlineOr('bob', false)).toBe(false);
});
