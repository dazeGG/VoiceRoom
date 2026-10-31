// The signed-in home: the lobby with its profile card host. The host once read
// the lobby's context from above the lobby and took the whole page down.

import { screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { beforeAll, expect, test, vi } from 'vitest';
import { useProfileCardUiStore } from '@/entities/profile-card/profile-card-ui.store';
import HomePage from '@/features/home/HomePage.vue';
import { stubFetch } from '../fixtures/fetch';
import { installFakeWebSocket } from '../fixtures/fake-websocket';
import { authUser } from '../fixtures/users';
import { stubMatchMedia } from '../helpers/match-media';
import { renderWithApp } from '../helpers/render';

// The lobby is a chunk the page loads on demand; compiling it here keeps that
// one-off cost out of the wait for the lobby to render.
beforeAll(async () => {
  await import('@/features/home/LobbyPage.vue');
});

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

test('a guest on the landing opens the sign-in from the header in place', async () => {
  // jsdom has no modal dialogs.
  for (const [name, open] of [
    ['showModal', true],
    ['close', false]
  ] as const) {
    if (name in HTMLDialogElement.prototype) continue;
    Object.defineProperty(HTMLDialogElement.prototype, name, {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = open;
      }
    });
  }
  installFakeWebSocket();
  stubMatchMedia();
  stubFetch({ 'GET /api/auth/me': { body: { ok: true, user: null } } });

  const { router } = await renderWithApp(HomePage);
  await userEvent.click(await screen.findByRole('link', { name: 'Войти' }, { timeout: 5000 }));

  expect(await screen.findByRole('dialog', { name: 'Вход' })).toBeTruthy();
  expect(router.currentRoute.value.fullPath).toBe('/?auth=login');
});
