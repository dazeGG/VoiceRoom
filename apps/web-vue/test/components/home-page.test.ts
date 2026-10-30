// The signed-in home: the lobby with its profile card host. The host once read
// the lobby's context from above the lobby and took the whole page down.

import { screen } from '@testing-library/vue';
import { expect, test, vi } from 'vitest';
import { useProfileCardUiStore } from '@/entities/profile-card/profile-card-ui.store';
import HomePage from '@/features/home/HomePage.vue';
import { stubFetch } from '../fixtures/fetch';
import { installFakeWebSocket } from '../fixtures/fake-websocket';
import { authUser } from '../fixtures/users';
import { stubMatchMedia } from '../helpers/match-media';
import { renderWithApp } from '../helpers/render';

test('a signed-in visit renders the lobby, and a profile card opens there', async () => {
  const errors: unknown[] = [];
  const onError = (event: PromiseRejectionEvent | ErrorEvent) => {
    const failure: { reason?: unknown; error?: unknown } = event;
    errors.push('reason' in event ? failure.reason : failure.error);
  };
  window.addEventListener('unhandledrejection', onError);
  window.addEventListener('error', onError);
  installFakeWebSocket();
  stubMatchMedia();
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

  const { pinia } = await renderWithApp(HomePage);
  expect(await screen.findByRole('button', { name: 'Создать комнату' }, { timeout: 5000 })).toBeTruthy();

  const anchor = document.createElement('button');
  document.body.append(anchor);
  useProfileCardUiStore(pinia).openProfileCardFor(
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
