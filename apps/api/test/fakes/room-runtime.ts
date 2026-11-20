// Dependencies for createRoomRealtimeRuntime with inert defaults; a test
// overrides what it drives. Store and registry are partial fakes typed as the
// real interfaces.

import { publicLobbyRoom, publicPeer, type StoredRoom } from '../../src/domains/rooms/room-views.ts';
import { publicChatMessage } from '../../src/domains/messaging/room-chat-views.ts';
import { createFullRoomRealtime } from '../../src/app/full-room-realtime.ts';
import { createLogger } from '../../src/lib/logger.ts';
import type { ConnectionRegistry } from '../../src/realtime/registry.ts';
import {
  createRoomRealtimeRuntime,
  type RoomRuntimeDeps,
  type RuntimeRoomStore
} from '../../src/realtime/room-runtime.ts';
import { fake } from './index.ts';

export type RuntimeDepsOverrides = Omit<Partial<TestRuntimeDeps>, 'wsRegistry' | 'getRoomStore'> & {
  store?: Partial<RuntimeRoomStore>;
  wsRegistry?: Partial<ConnectionRegistry>;
};

type TestRuntimeDeps = Omit<RoomRuntimeDeps, 'getRoomStore'> & {
  getRoomStore(): RuntimeRoomStore;
};

export function runtimeDeps({ store = {}, wsRegistry = {}, ...overrides }: RuntimeDepsOverrides = {}): TestRuntimeDeps {
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
  const deps: TestRuntimeDeps = {
    presenceRooms: new Map(),
    wsRegistry: fake<ConnectionRegistry>({
      detachVoicePeer() {},
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
    readHistory: async (room) =>
      (await deps.getRoomStore().listMessages(room.id, { limit: 100 })).map(publicChatMessage),
    publishRoomEvent() {},
    closePeer() {},
    avatarColorForPeerId: () => 'blue',
    MAX_ROOM_PEERS: 16,
    tokensMatch: (expected, actual) => expected === actual,
    sessionAvatarColorKey: () => 'blue',
    findRoomBan: async () => null,
    credentialBoundary: null,
    ...overrides
  };
  return deps;
}

export function createFullTestRuntime(deps: ReturnType<typeof runtimeDeps>) {
  const product = createFullRoomRealtime({
    ...deps,
    limits: deps,
    now: deps.now ?? Date.now,
    logger: deps.logger ?? createLogger({ name: 'api' })
  });
  return { ...createRoomRealtimeRuntime({ ...deps, ...product.callEffects }), ...product.handlers };
}
