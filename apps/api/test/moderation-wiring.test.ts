// The moderation module as the registry wires it, over a migrated database:
// what reaches the room's viewers when an owner removes a message. The
// registry has no path to the voice peers' own transports, so the deletion
// goes out on the room detail stream only.

import test from 'node:test';
import assert from 'node:assert/strict';

import type { ServerEnvelope } from '@voice-room/shared/realtime';
import { createServiceRegistry, type ServiceRegistryDeps } from '../src/app/service-registry.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';
import { fake, dbRoom } from './fakes/index.ts';
import { createConnectionRegistry } from '../src/realtime/registry.ts';
import { createRoomRealtimeRuntime } from '../src/realtime/room-runtime.ts';
import { runtimeDeps } from './fakes/room-runtime.ts';

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
  }
);

test(
  'member-list ban wiring detaches a preview-only account and invalidates its pending snapshot',
  { skip: !process.env.TEST_DATABASE_URL, timeout: 5000 },
  async (t) => {
    const db = await createTestDatabase(t);

    await db.pool.query(
      `INSERT INTO users(id, login, display_name, password_hash) VALUES ('owner','owner','O','x'),('target','target','T','x'); INSERT INTO rooms(id,owner_id,is_static) VALUES ('room','owner',true)`
    );
    const sockets = createConnectionRegistry({
      maxConnectionsPerUser: 4,
      keepaliveMs: 15000,
      getFriendIds: async () => []
    });
    const frames: string[] = [];
    const connection = sockets.addConnection('target', {
      readyState: 1,
      send: (data) => frames.push(data),
      close() {}
    });
    t.after(() => sockets.removeConnection(connection));
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let roomLookups = 0;
    t.after(() => release.resolve());
    const runtime = createRoomRealtimeRuntime(
      runtimeDeps({
        wsRegistry: sockets,
        store: {
          getRoom: async () => {
            if (++roomLookups === 1) return dbRoom('room');
            entered.resolve();
            await release.promise;
            return dbRoom('room');
          }
        }
      })
    );
    let swept = 0;
    const registry = createServiceRegistry(
      {
        ROOM_IDLE_TTL_MS: 60000,
        SESSION_TTL_MS: 60000,
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
        roomRuntime: () => runtime,
        detachAccountRoom: sockets.detachAccountRoom,
        disconnectModeratedAccount: async () => {
          assert.equal(sockets.roomDetailSubscribers('room').size, 0);
          assert.equal(connection.pendingPreviews?.size, 0);
          swept++;
        }
      })
    );
    registry.applyOverrides({ pool: db.pool });
    t.after(async () => {
      await registry.close(fake({ error() {} }));
      await db.cleanup();
    });
    const moderation = registry.getModerationServices();
    assert.ok(moderation);
    const pending = runtime.subscribePreview(connection, 'room');
    try {
      await entered.promise;
      const refused = await moderation.service.putBan({
        roomId: 'room',
        actorUserId: 'target',
        input: { userId: 'owner', duration: '1h' },
        idempotencyKey: 'refused'
      });
      assert.equal(refused.status, 'forbidden');
      assert.equal(sockets.roomDetailSubscribers('room').has(connection), true);
      assert.equal(connection.pendingPreviews?.size, 1);
      const result = await moderation.service.putBan({
        roomId: 'room',
        actorUserId: 'owner',
        input: { userId: 'target', duration: '1h' },
        idempotencyKey: 'accepted'
      });
      assert.equal(result.status, 'created');
      assert.equal(swept, 1);
      release.resolve();
      await pending;
      assert.equal(frames.length, 0);
      assert.equal(connection.previewRoomIds.size, 0);
      assert.equal(sockets.roomDetailSubscribers('room').size, 0);
    } finally {
      release.resolve();
      await pending;
    }
  }
);
