// The /r/<id> route for a signed-in visit renders the lobby, which hosts the
// profile card. The route once mounted a second host beside it: both opened on
// the shared card state, the second took focus, and the first closed them both.

import { cleanup, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';
import RoomRoute from '../../src/routes/r/[roomId]/+page.svelte';
import { openProfileCardFor } from '../../src/lib/entities/profile-card/profile-card-ui.svelte';
import { stubFetch } from '../fixtures/fetch.ts';
import { installFakeWebSocket } from '../fixtures/fake-websocket.ts';
import { authUser } from '../fixtures/users.ts';
import { stubMatchMedia } from '../helpers/match-media.ts';

vi.mock('$app/state', () => ({ page: { params: { roomId: 'room-1' } } }));

afterEach(cleanup);

test('a signed-in room link opens exactly one profile card, and it stays open', async () => {
  installFakeWebSocket();
  stubMatchMedia();
  const user = authUser({ id: 'ada', login: 'ada', displayName: 'Ада' });
  stubFetch({
    'GET /api/auth/me': { body: { ok: true, user } },
    'GET /api/auth/rooms': { body: { ok: true, rooms: [] } },
    'GET /api/friends': { body: { ok: true, incomingRequestCount: 0, friends: [] } },
    'GET /api/friends/requests': { body: { ok: true, incoming: [], outgoing: [] } }
  });

  render(RoomRoute);
  expect(await screen.findByRole('button', { name: 'Создать комнату' }, { timeout: 5000 })).toBeTruthy();

  const anchor = document.createElement('button');
  document.body.append(anchor);
  openProfileCardFor(
    {
      userId: 'bob',
      name: 'Боб',
      login: 'bob',
      avatarUrl: null,
      avatarColorKey: 'blue',
      avatarAccent: null,
      presence: 'online'
    },
    anchor
  );
  await screen.findByRole('dialog', { name: 'Профиль Боб' });
  for (let i = 0; i < 5; i += 1) await tick();

  expect(screen.getAllByRole('dialog', { name: 'Профиль Боб' })).toHaveLength(1);
});
