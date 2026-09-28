// The signed-in home: the lobby with its profile card host. The host once read
// the lobby's context from above the lobby and took the whole page down.

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, expect, test, vi } from 'vitest';
import HomePage from '../../src/lib/features/home/HomePage.svelte';
import { openProfileCardFor } from '../../src/lib/entities/profile-card/profile-card-ui.svelte';
import { stubFetch } from '../fixtures/fetch.ts';
import { installFakeWebSocket } from '../fixtures/fake-websocket.ts';
import { authUser } from '../fixtures/users.ts';

afterEach(cleanup);

test('a signed-in visit renders the lobby, and a profile card opens there', async () => {
  const errors: unknown[] = [];
  const onError = (event: PromiseRejectionEvent | ErrorEvent) =>
    errors.push('reason' in event ? event.reason : event.error);
  window.addEventListener('unhandledrejection', onError);
  window.addEventListener('error', onError);
  installFakeWebSocket();
  vi.stubGlobal('matchMedia', (media: string) => ({
    matches: false,
    media,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false
  }));
  const user = authUser({ id: 'ada', login: 'ada', displayName: 'Ада' });
  stubFetch({
    'GET /api/auth/me': { body: { ok: true, user } },
    'GET /api/auth/rooms': { body: { ok: true, rooms: [] } },
    'GET /api/friends': {
      body: {
        ok: true,
        incomingRequestCount: 0,
        friends: [
          {
            user: authUser({ id: 'bob', login: 'bob', displayName: 'Боб' }),
            online: true,
            friendsSince: 1,
            lastMessage: null,
            unreadCount: 0
          }
        ]
      }
    },
    'GET /api/friends/requests': { body: { ok: true, incoming: [], outgoing: [] } }
  });

  render(HomePage);
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
  expect(await screen.findByRole('dialog', { name: 'Профиль Боб' })).toBeTruthy();

  await vi.waitFor(() => expect(errors).toEqual([]));
  window.removeEventListener('unhandledrejection', onError);
  window.removeEventListener('error', onError);
});
