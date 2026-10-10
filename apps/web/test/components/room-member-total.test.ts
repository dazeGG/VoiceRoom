import { expect, test, vi } from 'vitest';
import { stubFetch } from '../fixtures/fetch.ts';
import {
  ensureRoomMembership,
  roomMemberTotal,
  roomMembershipState
} from '../../src/lib/entities/room/room-membership.svelte';

function member(userId: string, presenceStatus: string) {
  return {
    userId,
    displayName: userId,
    login: userId,
    avatarColorKey: 'blue',
    role: 'member',
    presenceStatus,
    inVoice: false
  };
}

test('the member total counts offline members too and falls back to the live count until the roster loads', async () => {
  const { calls } = stubFetch({
    '/api/rooms/room-total/members?limit=50': {
      body: {
        contractVersion: 1,
        roomId: 'room-total',
        members: [
          member('00000000-0000-4000-8000-000000000001', 'online'),
          member('00000000-0000-4000-8000-000000000002', 'offline'),
          member('00000000-0000-4000-8000-000000000003', 'offline')
        ],
        pageInfo: { hasMore: false },
        presenceRevision: 1
      }
    }
  });

  expect(roomMemberTotal('room-total', 0)).toBe(0);
  ensureRoomMembership('room-total');
  ensureRoomMembership('room-total');
  await vi.waitFor(() => expect(roomMembershipState.byRoomId['room-total']?.loaded).toBe(true));

  expect(roomMemberTotal('room-total', 0)).toBe(3);
  expect(calls).toHaveLength(1);
});
