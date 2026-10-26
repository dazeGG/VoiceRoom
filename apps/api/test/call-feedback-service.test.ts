// Who may see what of an answer's stay: the stay is the rooms section's to
// tell, where it came from (guest browser, address key, city) the origin's;
// numbers without either still show.

import test from 'node:test';
import assert from 'node:assert/strict';
import type { RoomStay } from '@voice-room/shared/contracts/admin';
import type { StaffPermission } from '@voice-room/shared/contracts/staff';
import { createCallFeedbackService } from '../src/domains/feedback/call-feedback.service.ts';
import type { StoredCallFeedback } from '../src/domains/feedback/call-feedback.repository.ts';
import type { StayAsk } from '../src/domains/admin/admin-rooms.repository.ts';

const GUEST_BROWSER = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

const answer: StoredCallFeedback = {
  id: 'f1',
  rating: 'bad',
  tags: ['poor_sound'],
  comment: '',
  createdAt: 1_000_000,
  author: null,
  roomId: 'kitchen',
  roomName: null,
  durationS: 600,
  peers: 1,
  platform: 'browser',
  quality: null,
  userId: null,
  guestId: GUEST_BROWSER
};

const stay: RoomStay = {
  id: 's1',
  roomId: 'kitchen',
  roomName: null,
  isStatic: false,
  account: null,
  guestName: 'Петя',
  guestId: GUEST_BROWSER,
  client: 'browser',
  os: 'Windows',
  browser: 'Chrome',
  ipKey: '72840b70e58cccb2',
  location: 'Воронеж, Россия',
  joinedAt: 400_000,
  leftAt: 999_000,
  network: [{ at: 400_000, level: 'bad' }]
};

function serviceFor(permissions: readonly StaffPermission[]) {
  const asked: StayAsk[][] = [];
  const service = createCallFeedbackService({
    repository: () => ({
      insert: () => Promise.resolve(),
      summarize: () => Promise.resolve({ good: 0, bad: 1, tags: [] }),
      listRecent: () => Promise.resolve([answer])
    }),
    staff: { can: (_userId, permission) => Promise.resolve(permissions.includes(permission)) },
    stays: (asks) => {
      asked.push([...asks]);
      return Promise.resolve(asks.map(() => stay));
    },
    now: () => 2_000_000
  });
  return { service, asked };
}

test('an administrator sees the stay of an answer and where it came from', async () => {
  const { service, asked } = serviceFor(['stats.view', 'rooms.view', 'origin.view']);
  const page = await service.list('admin', {});
  assert.deepEqual(asked, [[{ roomId: 'kitchen', userId: null, guestId: GUEST_BROWSER, at: 1_000_000 }]]);
  const [entry] = page?.entries ?? [];
  assert.deepEqual(entry?.stay, stay);
  assert.equal('userId' in (entry ?? {}), false, 'whose it was stays on the server');
  assert.equal('guestId' in (entry ?? {}), false);
});

test('without the origin the stay keeps who and how, not where from', async () => {
  const { service } = serviceFor(['stats.view', 'rooms.view']);
  const [entry] = (await service.list('analyst', {}))?.entries ?? [];
  assert.equal(entry?.stay?.guestName, 'Петя');
  assert.deepEqual(entry?.stay?.network, stay.network);
  assert.equal(entry?.stay?.guestId, null);
  assert.equal(entry?.stay?.ipKey, null);
  assert.equal(entry?.stay?.location, null);
});

test('without the rooms section there is no stay at all, and nobody looks one up', async () => {
  const { service, asked } = serviceFor(['stats.view', 'origin.view']);
  const page = await service.list('numbers-only', {});
  assert.equal(page?.entries[0]?.stay, null);
  assert.equal(page?.entries[0]?.rating, 'bad');
  assert.deepEqual(asked, []);
  assert.equal(await serviceFor(['rooms.view']).service.list('moderator', {}), null, 'no numbers without stats');
});
