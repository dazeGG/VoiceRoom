// The room preview shows who is in the call and a tile for each screen being
// shared; a stream tile enters the room to watch it, and a stopped share goes.

import { screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import RoomPreviewView from '@/features/home/components/lobby/RoomPreviewView.vue';
import { provideLobby } from '@/features/home/model/lobby-context';
import { useLobbyStore } from '@/features/home/model/lobby.store';
import type { OwnedRoom } from '@/api/auth';
import type { PublicPeer } from '@voice-room/shared/contracts/rooms';
import { stubFetch } from '../fixtures/fetch.ts';
import { FakeWebSocket, installFakeWebSocket } from '../fixtures/fake-websocket.ts';
import { authUser } from '../fixtures/users.ts';
import { stubMatchMedia } from '../helpers/match-media.ts';
import { renderWithApp } from '../helpers/render.ts';

const room: OwnedRoom = {
  roomId: 'kitchen',
  name: 'Кухня',
  createdAt: 1,
  avatarUrl: null,
  isStatic: true,
  relationship: 'member',
  peers: 2
};

function peer(id: string, name: string, extra: Partial<PublicPeer> = {}): PublicPeer {
  return {
    id,
    name,
    accountUserId: '',
    avatarAccent: null,
    avatarColorKey: 'blue',
    avatarUrl: null,
    serverMuted: false,
    ...extra
  };
}

beforeEach(() => {
  installFakeWebSocket();
  stubMatchMedia();
  stubFetch({});
  // The tile grid sizes itself to its box; jsdom has no layout to watch.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    }
  );
});

async function openSocket(): Promise<FakeWebSocket> {
  await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
  const socket = FakeWebSocket.latest();
  socket.open();
  return socket;
}

function renderPreview(onEnter = vi.fn()) {
  const Host = defineComponent(() => {
    provideLobby(useLobbyStore());
    return () => h(RoomPreviewView, { room, user: authUser(), onEnter, onBack: vi.fn() });
  });
  return renderWithApp(Host);
}

test('a shared screen gets its own tile that enters the room, and goes when the share stops', async () => {
  const onEnter = vi.fn();
  await renderPreview(onEnter);
  const socket = await openSocket();
  const ada = peer('p-ada', 'Ада', { screen: true });
  socket.receive({
    type: 'room.snapshot',
    payload: {
      roomId: 'kitchen',
      room: { ...room },
      peers: [ada, peer('p-bob', 'Боб')],
      recentMessages: [],
      voiceActiveSince: 1,
      mode: 'preview'
    }
  });

  const tile = await screen.findByRole('button', { name: 'Войти и смотреть стрим Ада' });
  expect(screen.getByText('Стрим откроется после входа')).toBeTruthy();
  expect(document.querySelectorAll('.room-preview__participant')).toHaveLength(2);
  await userEvent.click(tile);
  expect(onEnter).toHaveBeenCalledOnce();

  socket.receive({ type: 'room.peer.updated', payload: { roomId: 'kitchen', peer: { ...ada, screen: false } } });
  await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Войти и смотреть стрим Ада' })).toBeNull());
  expect(document.querySelectorAll('.room-preview__participant')).toHaveLength(2);
});

test('before joining there is no call dock, only a note and one way in', async () => {
  const onEnter = vi.fn();
  await renderPreview(onEnter);

  expect(await screen.findByText('Звук и видео включатся после входа')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Выбрать микрофон' })).toBeNull();
  expect(document.querySelector('.participant--speaking')).toBeNull();

  await userEvent.click(screen.getByRole('button', { name: 'Войти в комнату' }));
  expect(onEnter).toHaveBeenCalledOnce();
});
