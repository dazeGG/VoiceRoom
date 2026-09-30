// What the room chat does with realtime events: an edit that overtakes its
// message still lands, and a guest never asks for account-only history. One
// render only: the realtime client is one per page.

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import RoomChatPanel from '../../src/lib/features/room/components/RoomChatPanel.svelte';
import type { RoomMessage } from '@voice-room/shared/contracts/messages';
import { stubFetch } from '../fixtures/fetch.ts';
import { FakeWebSocket, installFakeWebSocket } from '../fixtures/fake-websocket.ts';

const NOW = Date.now();

function roomMessage(id: string, peerId: string, text: string, extra: Partial<RoomMessage> = {}): RoomMessage {
  return {
    authorUserId: null,
    avatarAccent: null,
    avatarColorKey: 'blue',
    avatarUrl: null,
    createdAt: NOW,
    editedAt: null,
    id,
    name: peerId === 'me' ? 'Я' : 'Ада',
    peerId,
    roomId: 'room',
    text,
    attachments: [],
    ...extra
  };
}

beforeEach(() => {
  installFakeWebSocket();
  localStorage.clear();
});

afterEach(cleanup);

async function renderGuestPanel() {
  const { calls } = stubFetch({
    'GET /api/rooms/room/chat': { body: { ok: true, roomId: 'room', messages: [roomMessage('m1', 'ada', 'привет')] } },
    'GET /api/rooms/room/pins': { body: { ok: true, pins: [], count: 0 } }
  });
  render(RoomChatPanel, {
    props: { roomId: 'room', peerId: 'me', sessionToken: 'token', resolveDisplayName: () => 'Я', onToast: vi.fn() }
  });
  await screen.findByText('привет');
  await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
  const socket = FakeWebSocket.latest();
  socket.open();
  return { calls, socket };
}

test('a guest keeps a link preview that overtook its message, and never asks for account history', async () => {
  const { calls, socket } = await renderGuestPanel();
  const text = 'смотри https://example.com';
  const linkPreview = {
    url: 'https://example.com/',
    title: 'Example Domain',
    description: '',
    siteName: 'example.com',
    image: null
  };

  socket.receive({
    type: 'room.chat.edited',
    payload: { roomId: 'room', message: roomMessage('m2', 'ada', text, { linkPreview }) }
  });
  socket.receive({ type: 'room.chat.message', payload: { roomId: 'room', message: roomMessage('m2', 'ada', text) } });

  expect(await screen.findByText('Example Domain')).toBeTruthy();
  // Read cursors and paged history are account-only: a guest never asks.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(calls.filter((call) => call.url.includes('/chat/history'))).toEqual([]);
});
