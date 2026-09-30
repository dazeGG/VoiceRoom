// Room invitations travel as direct messages with room-invite metadata, so
// both people see the same invitation and its outcome in the thread.

import { expect, test } from 'vitest';
import { fetchThreadPage, respondRoomInvite } from '../../src/lib/api/dm.ts';
import { stubFetch } from '../fixtures/fetch.ts';

const PEER = '22222222-2222-4222-8222-222222222222';

function historyMessage(id: string, metadata: Record<string, unknown>) {
  return { id, author: { userId: PEER }, content: { text: '' }, createdAt: 1000, metadata };
}

test('a history page turns room-invite metadata into an invitation with its outcome', async () => {
  stubFetch({
    [`/api/dm/${PEER}/history?mode=latest&limit=50`]: {
      body: {
        contractVersion: 1,
        mode: 'latest',
        pageInfo: { hasMoreBefore: false, hasMoreAfter: false },
        messages: [
          historyMessage('m1', { kind: 'room-invite', roomId: 'abc123', roomName: 'Планёрка', expiresAt: 5000 }),
          historyMessage('m2', { kind: 'room-invite', roomId: 'abc123', roomName: 'Планёрка', status: 'declined' }),
          historyMessage('m3', { kind: 'room-invite', roomId: 'abc123', status: 'bogus' }),
          historyMessage('m4', {})
        ]
      }
    }
  });

  const page = await fetchThreadPage(PEER);
  expect(page.messages.map((message) => message.invite)).toEqual([
    { roomId: 'abc123', roomName: 'Планёрка', status: 'pending', expiresAt: 5000 },
    { roomId: 'abc123', roomName: 'Планёрка', status: 'declined', expiresAt: null },
    { roomId: 'abc123', roomName: '', status: 'pending', expiresAt: null },
    null
  ]);
});

test('answering an invitation posts the decision for that message', async () => {
  const { calls } = stubFetch({
    [`POST /api/dm/${PEER}/invites/m1/respond`]: { body: { message: { id: 'm1', invite: { status: 'accepted' } } } }
  });
  const message = await respondRoomInvite(PEER, 'm1', 'accept');
  expect(calls).toEqual([{ method: 'POST', url: `/api/dm/${PEER}/invites/m1/respond`, body: { action: 'accept' } }]);
  expect(message.id).toBe('m1');
});
