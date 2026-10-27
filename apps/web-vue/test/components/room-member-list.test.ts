import type { MemberPresenceStatus } from '@voice-room/shared/contracts/membership';
import { screen } from '@testing-library/vue';
import { expect, test } from 'vitest';
import RoomMemberList from '@/entities/room/components/RoomMemberList.vue';
import { useSessionStore } from '@/features/auth/session.store';
import { stubFetch } from '../fixtures/fetch.ts';
import { authUser } from '../fixtures/users.ts';
import { renderWithApp } from '../helpers/render.ts';

function member(userId: string, displayName: string, presenceStatus: MemberPresenceStatus) {
  return {
    userId,
    displayName,
    login: displayName.toLowerCase(),
    avatarColorKey: 'blue',
    avatarUrl: null,
    avatarAccent: null,
    role: 'member',
    joinedAt: null,
    presenceStatus,
    inVoice: false
  };
}

test('the participants tab lists the roster from the server, split into online and offline', async () => {
  const { calls } = stubFetch({
    '/api/rooms/room-a/members?limit=50': {
      body: {
        contractVersion: 1,
        roomId: 'room-a',
        members: [
          member('00000000-0000-4000-8000-000000000001', 'Anna', 'online'),
          member('00000000-0000-4000-8000-000000000002', 'Boris', 'afk'),
          member('00000000-0000-4000-8000-000000000003', 'Vera', 'offline')
        ],
        pageInfo: { hasMore: false },
        presenceRevision: 1
      }
    }
  });

  const { pinia } = await renderWithApp(RoomMemberList, { props: { roomId: 'room-a' } });
  useSessionStore(pinia).user = authUser();

  expect(await screen.findByRole('heading', { name: 'В сети 2' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Не в сети 1' })).toBeTruthy();
  expect(screen.getByText('Anna')).toBeTruthy();
  expect(screen.getByText('Vera')).toBeTruthy();
  expect(calls.map((call) => call.url)).toEqual(['/api/rooms/room-a/members?limit=50']);
});

test('a guest is told the roster needs an account instead of getting an error', async () => {
  const { calls } = stubFetch({});
  await renderWithApp(RoomMemberList, { props: { roomId: 'room-b' } });

  expect(screen.getByText('Список участников виден после входа в аккаунт.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull();
  expect(calls).toEqual([]);
});
