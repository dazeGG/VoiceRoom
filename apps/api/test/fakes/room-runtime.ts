// Dependencies for createRoomRealtimeRuntime with inert defaults; a test
// overrides what it drives. Store and registry are partial fakes typed as the
// real interfaces.

import { publicLobbyRoom, publicPeer, type StoredRoom } from '../../src/domains/rooms/room-views.ts';
import { publicChatMessage } from '../../src/domains/messaging/room-chat-views.ts';
import type { ConnectionRegistry } from '../../src/realtime/registry.ts';
import type { RoomRuntimeDeps, RuntimeRoomStore } from '../../src/realtime/room-runtime.ts';
import { fake } from './index.ts';

export type RuntimeDepsOverrides = Omit<Partial<RoomRuntimeDeps>, 'wsRegistry'> & {
  store?: Partial<RuntimeRoomStore>;
  wsRegistry?: Partial<ConnectionRegistry>;
};

export function runtimeDeps({ store = {}, wsRegistry = {}, ...overrides }: RuntimeDepsOverrides = {}): RoomRuntimeDeps {
  const roomStore = fake<RuntimeRoomStore>({
    async getRoom() {
      return null;
    },
    async listMessages() {
      return [];
    },
    async listSummaryRecipientUserIds() {
      return [];
    },
    ...store
  });
  return {
    presenceRooms: new Map(),
    wsRegistry: fake<ConnectionRegistry>({
      registerConnectionForRoom() {},
      roomDetailSubscribers() {
        return new Set();
      },
      sendToConnection() {
        return true;
      },
      sendToUser() {
        return 0;
      },
      unregisterConnectionForRoom() {},
      unregisterConnectionFromAllRooms() {},
      ...wsRegistry
    }),
    getRoomStore: () => roomStore,
    getRoom: async () => null,
    publicPeer,
    publicLobbyRoom: (room: StoredRoom) => publicLobbyRoom(room, 0),
    publicChatMessage,
    broadcast() {},
    closePeer() {},
    avatarColorForPeerId: () => 'blue',
    MAX_ROOM_PEERS: 16,
    tokensMatch: (expected, actual) => expected === actual,
    sessionAvatarColorKey: () => 'blue',
    ...overrides
  };
}
