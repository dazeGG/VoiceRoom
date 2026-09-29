// The room preview shows who is in the call and a tile for each screen being
// shared; a stream tile enters the room to watch it, and a stopped share goes.

import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import RoomPreviewView from '../../src/lib/features/home/components/lobby/RoomPreviewView.svelte';
import type { OwnedRoom } from '../../src/lib/api/auth';
import type { PublicPeer } from '@voice-room/shared/contracts/rooms';
import { stubFetch } from '../fixtures/fetch.ts';
import { FakeWebSocket, installFakeWebSocket } from '../fixtures/fake-websocket.ts';
import { authUser } from '../fixtures/users.ts';
import { LobbyStore } from '../../src/lib/features/home/model/lobby.svelte';
import { lobbyContext } from '../../src/lib/features/home/model/lobby-context';
import { stubMatchMedia } from '../helpers/match-media.ts';

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
});
afterEach(cleanup);

async function openSocket(): Promise<FakeWebSocket> {
  await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
  const socket = FakeWebSocket.latest();
  socket.open();
  return socket;
}

test('a shared screen gets its own tile that enters the room, and goes when the share stops', async () => {
  const onEnter = vi.fn();
  render(RoomPreviewView, {
    props: { room, user: authUser(), onEnter, onBack: vi.fn() },
    context: lobbyContext(new LobbyStore())
  });
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
  expect(document.querySelectorAll('.lobby-preview-participant')).toHaveLength(2);
  await userEvent.click(tile);
  expect(onEnter).toHaveBeenCalledOnce();

  socket.receive({ type: 'room.peer.updated', payload: { roomId: 'kitchen', peer: { ...ada, screen: false } } });
  await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Войти и смотреть стрим Ада' })).toBeNull());
  expect(document.querySelectorAll('.lobby-preview-participant')).toHaveLength(2);
});
