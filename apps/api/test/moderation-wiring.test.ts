// The moderation services as server.ts wires them, over a migrated database:
// what reaches the room's viewers when an owner removes a message.

import test from 'node:test';
import assert from 'node:assert/strict';

import type { ServerEnvelope } from '@voice-room/shared/realtime';
import { createServiceRegistry, type ServiceRegistryDeps } from '../src/app/service-registry.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import type { RoomPeerMessage } from '../src/realtime/legacy-events.ts';
import { createTestDatabase } from './db-harness.ts';
import { fake } from './fakes/index.ts';

const OWNER = '11111111-1111-4111-8111-111111111111';
const ROOM = 'moderated';
const silent = { log() {}, info() {}, warn() {}, error() {} };

test(
  'an owner removing a room message takes it out of every chat and leaves the voice peers connected',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const db = await createTestDatabase(t);
    await runMigrations({ databaseUrl: db.databaseUrl, logger: silent, noLock: true });
    await db.pool.query(
      `INSERT INTO users(id, login, display_name, password_hash) VALUES ($1, 'owner', 'Owner', 'x');
       INSERT INTO rooms(id, owner_id, is_static) VALUES ('${ROOM}', $1, true);
       INSERT INTO room_messages(id, room_id, text, author_user_id) VALUES ('m-1', '${ROOM}', 'spam', $1);`.replace(
        /\$1/g,
        `'${OWNER}'`
      )
    );

    const detail: Array<[string, ServerEnvelope]> = [];
    const peerMessages: RoomPeerMessage[] = [];
    const registry = createServiceRegistry(
      {
        ROOM_IDLE_TTL_MS: 60_000,
        SESSION_TTL_MS: 60_000,
        GEOIP_DB_PATH: '',
        LIVEKIT_GATE_SECRET: 'gate-secret-for-tests-0123456789abcdef',
        LIVEKIT_GATE_CREDENTIAL_TTL_SECONDS: 60,
        LIVEKIT_TOKEN_TTL_SECONDS: 60,
        MAX_ROOM_BANS: 10,
        MAX_PUSH_SUBSCRIPTIONS_PER_USER: 5,
        LINK_PREVIEWS_ENABLED: false
      },
      fake<ServiceRegistryDeps>({
        getRoom: async () => null,
        broadcast: (_room, message) => peerMessages.push(message),
        roomRuntime: () => ({ broadcastRoomDetail: (roomId, envelope) => detail.push([roomId, envelope]) })
      })
    );
    registry.applyOverrides({ pool: db.pool });
    t.after(async () => {
      await registry.close(fake());
      await db.cleanup();
    });

    const moderation = registry.getModerationServices();
    assert.ok(moderation);
    const outcome = await moderation.messageService.deleteRoomMessage({
      roomId: ROOM,
      messageId: 'm-1',
      actorUserId: OWNER
    });

    assert.equal(outcome.status, 'deleted');
    assert.deepEqual(detail, [[ROOM, { type: 'room.chat.deleted', payload: { roomId: ROOM, messageId: 'm-1' } }]]);
    // Nothing goes to the voice peers' own transports: a message they cannot
    // map would count as a failed send and drop them from the room.
    assert.deepEqual(peerMessages, []);
  }
);
