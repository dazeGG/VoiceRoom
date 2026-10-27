import type { MemberPresenceStatus } from '@voice-room/shared/contracts/membership';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, expect, test, vi } from 'vitest';
import { useRoomMembershipStore } from '@/entities/room/room-membership.store';
import { stubFetch } from './fixtures/fetch.ts';

beforeEach(() => setActivePinia(createPinia()));

function member(userId: string, presenceStatus: MemberPresenceStatus) {
  return {
    userId,
    displayName: userId,
    login: userId,
    avatarColorKey: 'blue',
    avatarUrl: null,
    avatarAccent: null,
    role: 'member',
    joinedAt: null,
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
  const membership = useRoomMembershipStore();
  const { ensureRoomMembership, roomMemberTotal } = membership;

  expect(roomMemberTotal('room-total', 0)).toBe(0);
  ensureRoomMembership('room-total');
  ensureRoomMembership('room-total');
  await vi.waitFor(() => expect(membership.byRoomId['room-total']?.loaded).toBe(true));

  expect(roomMemberTotal('room-total', 0)).toBe(3);
  expect(calls).toHaveLength(1);
});
