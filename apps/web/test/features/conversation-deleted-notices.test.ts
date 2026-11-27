// Message notices that wait for the notification preferences are dropped when
// their conversation is deleted meanwhile: the browser never shows its text.

import { afterEach, expect, test, vi } from 'vitest';
import { friend, publicUser } from '../fixtures/answers.ts';
import { stubFetch } from '../fixtures/fetch.ts';
import { notificationPreferences } from '../fixtures/users.ts';
import { freshImport } from '../helpers/fresh-module.ts';

type Handler = (event: { type: string; payload: Record<string, unknown> }) => void;
let emit: Handler = () => {};
vi.mock('../../src/api/realtime', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAppRealtime: () => ({
    subscribe: (onEvent: Handler) => {
      emit = onEvent;
      return vi.fn();
    }
  })
}));

const shown = vi.fn();
vi.mock('../../src/shared/notifications/router', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  routeNotificationEvent: (event: { payload: { peer?: { id: string } } }) => ({
    notify: true,
    payload: { peerId: event.payload.peer?.id }
  }),
  showBrowserNotification: async (payload: unknown) => {
    shown(payload);
  }
}));

vi.mock('@voiceroom/call/engine/media/cues', () => ({
  playDirectMessageCue: vi.fn(),
  playFriendAcceptedCue: vi.fn(),
  playFriendRequestCue: vi.fn(),
  playRingCue: vi.fn()
}));

let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  stop = null;
  shown.mockReset();
});

const notice = (peerId: string, body: string) => ({
  type: 'notification.dm.message',
  payload: {
    dedupeKey: `dm:${peerId}`,
    peer: { id: peerId, login: peerId, displayName: peerId },
    message: { id: `${peerId}-message`, body, createdAt: 1 }
  }
});

test('a buffered message notice of a deleted conversation is never shown', async () => {
  let releasePreferences = () => {};
  const preferencesHeld = new Promise<void>((resolve) => {
    releasePreferences = resolve;
  });
  stubFetch({
    '/api/friends': {
      body: {
        ok: true,
        friends: ['anna', 'boris'].map((id) => friend({ user: publicUser({ id, login: id }) })),
        incomingRequestCount: 0
      }
    },
    '/api/friends/requests': { body: { ok: true, incoming: [], outgoing: [] } },
    '/api/notifications/preferences': { body: { ok: true, preferences: notificationPreferences() } }
  });
  const passThrough = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    if (url === '/api/notifications/preferences') await preferencesHeld;
    return passThrough(input, init);
  });
  const { useLobbyStore } = await freshImport(() => import('../../src/features/home/model/lobby.store.ts'));
  const lobby = useLobbyStore();
  stop = lobby.init('me');
  await vi.waitFor(() => expect(lobby.loaded).toBe(true));

  emit(notice('anna', 'Удалённый текст'));
  emit(notice('boris', 'Обычное сообщение'));
  emit({ type: 'dm.conversation.deleted', payload: { peerId: 'anna' } });
  releasePreferences();

  await vi.waitFor(() => expect(shown).toHaveBeenCalledTimes(1));
  expect(shown).toHaveBeenCalledWith({ peerId: 'boris' });
});
