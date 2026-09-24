import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, expect, test } from 'vitest';
import RoomMemberList from '../../src/lib/features/home/components/lobby/RoomMemberList.svelte';
import { stubFetch } from '../fixtures/fetch.ts';

afterEach(cleanup);

function member(userId: string, displayName: string, presenceStatus: string) {
  return { userId, displayName, login: displayName.toLowerCase(), avatarColorKey: 'blue', role: 'member', presenceStatus, inVoice: false };
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

  render(RoomMemberList, { props: { roomId: 'room-a' } });

  expect(await screen.findByText('В сети — 2')).toBeTruthy();
  expect(screen.getByText('Не в сети — 1')).toBeTruthy();
  expect(screen.getByText('Anna')).toBeTruthy();
  expect(screen.getByText('Vera')).toBeTruthy();
  expect(calls.map((call) => call.url)).toEqual(['/api/rooms/room-a/members?limit=50']);
});
