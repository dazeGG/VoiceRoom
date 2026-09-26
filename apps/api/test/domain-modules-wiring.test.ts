// What the domain modules wire between services: who may see a message's
// reactions, what a ban does inside and after its transaction, and what
// pauses media uploads.

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type pg from 'pg';

import { createReactionsModule, type ReactionsModuleDeps } from '../src/domains/messaging/reactions.module.ts';
import { createModerationModule } from '../src/domains/moderation/moderation.module.ts';
import { createServiceRegistry, type ServiceRegistryDeps } from '../src/app/service-registry.ts';
import type { LiveRoom, PresencePeer } from '../src/domains/rooms/room-views.ts';
import { createCursorCodec } from '../src/platform/cursor-codec.ts';
import { normalizeGatePrincipal } from '../src/domains/admission/gate-credential.repository.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';
import { fake, fakeDb } from './fakes/index.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const cursorCodec = createCursorCodec({ keys: 'wiring-test-cursor-key-0123456789abcdef' });

function reactions(overrides: Partial<ReactionsModuleDeps> = {}) {
  const asked: string[] = [];
  const module = createReactionsModule({
    pool: fakeDb(),
    cursorCodec,
    roomExists: async (roomId) => roomId === 'room',
    roomMessageExists: async (roomId, messageId) => roomId === 'room' && messageId === 'm1',
    directMessageVisible: async (userId, peerId, messageId) =>
      userId === 'ada' && peerId === 'bob' && messageId === 'dm1',
    canReadRoom: async (_roomId, userId) => {
      asked.push(`read:${userId}`);
      return userId !== 'outsider';
    },
    canReactInRoom: async (_roomId, userId) => {
      asked.push(`react:${userId}`);
      return userId === 'member';
    },
    broadcastRoomDetail: () => {},
    sendToUser: () => 1,
    writesEnabled: () => true,
    ...overrides
  });
  return { service: module.service, asked };
}

const notVisible = { code: 'message_not_visible' };

test('reaction reads and writes follow the room chat rules and the DM pair', async () => {
  const { service, asked } = reactions();
  const room = { type: 'room', id: 'room' };

  assert.deepEqual(await service.getSummaries({ conversation: room, messageId: 'm1' }), [], 'a guest reads');
  await assert.rejects(
    service.getSummaries({ conversation: { type: 'room', id: 'gone' }, messageId: 'm1' }),
    notVisible
  );
  await assert.rejects(service.getSummaries({ conversation: room, messageId: 'other' }), notVisible);

  await service.getSummaries({ conversation: room, messageId: 'm1', viewer: { id: 'member' } });
  await assert.rejects(
    service.getSummaries({ conversation: room, messageId: 'm1', viewer: { id: 'outsider' } }),
    notVisible
  );
  const reactAs = (viewer?: { id: string }) =>
    service.setDesired({ conversation: room, mutation: { messageId: 'm1', emoji: '👍', active: true }, viewer });
  await assert.rejects(reactAs(), { code: 'account_required' }, 'a guest cannot react');
  await assert.rejects(reactAs({ id: 'reader' }), notVisible, 'reading is not reacting');
  assert.deepEqual(asked, ['read:member', 'read:outsider', 'react:reader']);

  const dm = { type: 'dm', id: 'bob' };
  assert.deepEqual(await service.getSummaries({ conversation: dm, messageId: 'dm1', viewer: { id: 'ada' } }), []);
  await assert.rejects(service.getSummaries({ conversation: dm, messageId: 'dm1', viewer: { id: 'eve' } }), notVisible);
  await assert.rejects(service.getSummaries({ conversation: dm, messageId: 'dm1' }), notVisible);
});

async function banSetup(t: TestContext) {
  const db = await createTestDatabase(t);
  t.after(db.cleanup);
  await runMigrations({ databaseUrl: db.databaseUrl, logger: SILENT, noLock: true });
  await db.pool.query(
    `INSERT INTO users (id, login, display_name, password_hash) VALUES ('owner', 'owner', 'O', 'x'), ('target', 'target', 'T', 'x');
     INSERT INTO rooms (id, owner_id, is_static) VALUES ('room', 'owner', true)`
  );
  return db.pool;
}

test(
  'a ban revokes the account inside its transaction and disconnects the peer once committed',
  {
    skip: !process.env.TEST_DATABASE_URL
  },
  async (t) => {
    const pool = await banSetup(t);
    const banCount = async () =>
      Number((await pool.query<{ n: string }>('SELECT count(*) AS n FROM room_bans')).rows[0]?.n);
    const events: string[] = [];
    const peer: PresencePeer = { id: 'peer-1', accountUserId: 'target' };
    const bystander: PresencePeer = { id: 'peer-2', accountUserId: 'owner' };
    const room = {
      id: 'room',
      peers: new Map([
        [peer.id, peer],
        [bystander.id, bystander]
      ])
    } as unknown as LiveRoom;

    const moderation = createModerationModule({
      pool,
      cursorCodec,
      maxActiveBans: 10,
      roomStore: () => ({
        normalizeGatePrincipal,
        revokeLiveKitGatePrincipalInTransaction: async (client, { principal }) => {
          const inTransaction = client !== pool;
          events.push(
            `revoke ${principal.principalId}, in transaction: ${inTransaction}, committed bans: ${await banCount()}`
          );
          return { status: 'revoked', epoch: 1 };
        }
      }),
      getRoom: async (roomId) => (roomId === 'room' ? room : null),
      gatePrincipalForPeer: () => null,
      disconnectPeer: async (_room, target, type, options) => {
        events.push(
          `disconnect ${target.id} ${type} gateAlreadyRevoked=${String(options.gateAlreadyRevoked)}, committed bans: ${await banCount()}`
        );
      },
      broadcastRoomDetail: () => {}
    });

    const outcome = await moderation.service.putBan({
      roomId: 'room',
      actorUserId: 'owner',
      idempotencyKey: 'ban-1',
      input: { userId: 'target', duration: '1h' }
    });
    assert.equal(outcome.status, 'created');
    assert.deepEqual(events, [
      'revoke target, in transaction: true, committed bans: 0',
      'disconnect peer-1 room.banned gateAlreadyRevoked=true, committed bans: 1'
    ]);
  }
);

test('media uploads pause while the API replicas disagree on readiness', async (t) => {
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-wiring-'));
  t.after(() => fs.rmSync(storageDir, { recursive: true, force: true }));
  let consensus = false;
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
      LINK_PREVIEWS_ENABLED: false,
      MEDIA_STORAGE_DIR: storageDir,
      MEDIA_MIN_FREE_BYTES: 1
    },
    fake<ServiceRegistryDeps>({ readinessProvider: { getSnapshot: () => ({ replicaConsensus: consensus }) } })
  );
  registry.applyOverrides({ pool: fakeDb() as unknown as pg.Pool });
  const pressure = registry.getMediaServices()!.pressure;

  assert.equal((await pressure.measure({ force: true })).reason, 'replica_disagreement');
  await assert.rejects(pressure.assertAcceptingUploads(), { code: 'MEDIA_PRESSURE' });
  consensus = true;
  assert.equal((await pressure.measure({ force: true })).reason, 'ready');
});
