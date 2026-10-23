// A message's time reads the same in the room chat as in direct messages:
// 24-hour "14:05", whatever locale the browser runs in.

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import RoomChatPanel from '../../src/lib/features/room/components/RoomChatPanel.svelte';
import { clockTime } from '../../src/lib/shared/utils/date-format.ts';
import type { RoomMessage } from '@voice-room/shared/contracts/messages';
import { stubFetch } from '../fixtures/fetch.ts';
import { installFakeWebSocket } from '../fixtures/fake-websocket.ts';

const AFTERNOON = new Date(2026, 9, 23, 14, 5).getTime();

const message: RoomMessage = {
  authorUserId: null,
  avatarAccent: null,
  avatarColorKey: 'blue',
  avatarUrl: null,
  createdAt: AFTERNOON,
  editedAt: null,
  id: 'm1',
  name: 'Ада',
  peerId: 'ada',
  roomId: 'room',
  text: 'привет',
  attachments: []
};

// A browser whose own locale is English: calls that name no locale get en-US.
function runInEnglishBrowser(): void {
  vi.spyOn(Date.prototype, 'toLocaleTimeString').mockImplementation(function (
    this: Date,
    locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions
  ) {
    const named =
      typeof locales === 'string' || locales instanceof Intl.Locale || (locales !== undefined && locales.length > 0);
    const fields = options ?? { hour: 'numeric', minute: 'numeric', second: 'numeric' };
    return new Intl.DateTimeFormat(named ? locales : 'en-US', fields).format(this);
  });
}

beforeEach(() => {
  installFakeWebSocket();
  localStorage.clear();
  runInEnglishBrowser();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test('the room chat writes a message time on the 24-hour clock in an English browser', async () => {
  stubFetch({
    'GET /api/rooms/room/chat': { body: { ok: true, roomId: 'room', messages: [message] } },
    'GET /api/rooms/room/pins': { body: { ok: true, pins: [], count: 0 } },
    'POST /api/rooms/room/read': { body: { ok: true } },
    'GET /api/reactions/room/room/m1': { body: { ok: true, summaries: [] } }
  });
  render(RoomChatPanel, {
    props: { roomId: 'room', peerId: 'me', sessionToken: 'token', resolveDisplayName: () => 'Я', onToast: vi.fn() }
  });
  await screen.findByText('привет');

  const time = document.querySelector('time.chat-msg-time');
  expect(time?.textContent).toBe('14:05');
  // Direct messages write their time with the same clock.
  expect(time?.textContent).toBe(clockTime(AFTERNOON));
});

test('the clock is 24-hour with two-digit hours in an English browser', () => {
  expect(clockTime(new Date(2026, 9, 23, 0, 7))).toBe('00:07');
  expect(clockTime(new Date(2026, 9, 23, 9, 30).getTime())).toBe('09:30');
  expect(clockTime(AFTERNOON)).toBe('14:05');
  expect(clockTime(new Date(2026, 9, 23, 23, 59).toISOString())).toBe('23:59');
});
