'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const { Pool } = require('pg');

const { createPinRepository } = require('../src/domains/messaging/pin-repository');
const { createPinService } = require('../src/domains/messaging/pin-service');
const { registerPinRoutes } = require('../src/domains/messaging/pin-routes');
const { createRoomStore } = require('../src/lib/room-store');
const { createUserStore } = require('../src/lib/user-store');
const { runMigrations } = require('../src/lib/migrate');
const { createTestDatabase } = require('./db-harness');

const SILENT = { log() {}, info() {}, warn() {}, error() {} };

async function createPinFixture(t) {
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  await runMigrations({ databaseUrl, logger: SILENT });
  const pool = new Pool({ connectionString: databaseUrl, max: 12 });
  const users = createUserStore({ databaseUrl, logger: SILENT });
  const rooms = createRoomStore({ databaseUrl, logger: SILENT });
  const created = await users.createUser({ login: 'pin-user', displayName: 'Pin User', password: 'password123' });
  const user = created.user;
  const room = await rooms.createRoom({ roomId: 'pin-room', creatorIp: '127.0.0.1', ownerId: user.id, isStatic: true });
  t.after(async () => {
    await pool.end();
    await rooms.close();
    await users.close();
    await cleanup();
  });
  return { pool, repository: createPinRepository({ client: pool }), room, rooms, user };
}

test('51 concurrent distinct pins preserve the 50-pin room cap', async (t) => {
  const fixture = await createPinFixture(t);
  const service = createPinService({ repository: fixture.repository });
  const messages = await Promise.all(Array.from({ length: 51 }, (_, index) => fixture.rooms.appendMessage(
    fixture.room.id,
    { authorUserId: fixture.user.id, peerId: `peer-${index}`, text: `message-${index}`, expiresAt: Date.now() + 60_000 }
  )));

  const results = await Promise.allSettled(messages.map((message) => service.pin({
    roomId: fixture.room.id,
    messageId: message.id,
    viewer: fixture.user
  })));

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 50);
  const rejection = results.find((result) => result.status === 'rejected');
  assert.equal(rejection.reason.code, 'pin_limit_reached');
  assert.equal((await service.list({ roomId: fixture.room.id })).count, 50);
});

test('pin refresh publishes edited message text', async (t) => {
  const fixture = await createPinFixture(t);
  const events = [];
  const service = createPinService({ repository: fixture.repository, publish: async (event) => events.push(event) });
  const message = await fixture.rooms.appendMessage(fixture.room.id, {
    authorUserId: fixture.user.id,
    peerId: 'peer-edit',
    text: 'before',
    expiresAt: Date.now() + 60_000
  });
  await service.pin({ roomId: fixture.room.id, messageId: message.id, viewer: fixture.user });

  await fixture.pool.query(`UPDATE room_messages SET text = 'after' WHERE id = $1`, [message.id]);
  const refreshed = await service.refresh({ roomId: fixture.room.id, action: 'message-edited', messageId: message.id });

  assert.equal(refreshed.pins[0].text, 'after');
  assert.equal(events.at(-1).pins[0].text, 'after');
});

test('pin refresh removes soft-deleted messages from the snapshot', async (t) => {
  const fixture = await createPinFixture(t);
  const service = createPinService({ repository: fixture.repository });
  const message = await fixture.rooms.appendMessage(fixture.room.id, {
    authorUserId: fixture.user.id,
    peerId: 'peer-delete',
    text: 'delete me',
    expiresAt: Date.now() + 60_000
  });
  await service.pin({ roomId: fixture.room.id, messageId: message.id, viewer: fixture.user });

  await fixture.pool.query(`UPDATE room_messages SET deleted_at = now() WHERE id = $1`, [message.id]);
  const refreshed = await service.refresh({ roomId: fixture.room.id, action: 'message-deleted', messageId: message.id });

  assert.deepEqual(refreshed, { pins: [], count: 0 });
});

test('bookmark access can read pins but cannot mutate them without membership', async (t) => {
  const app = Fastify({ logger: false });
  t.after(() => app.close());
  const calls = [];
  registerPinRoutes({
    app,
    pinService: {
      async list() { calls.push('list'); return { pins: [], count: 0 }; },
      async pin() { calls.push('pin'); return { pins: [], count: 0 }; },
      async unpin() { calls.push('unpin'); return { pins: [], count: 0 }; }
    },
    async resolveRoomAccess({ action }) {
      return action === 'read'
        ? { authorized: true, viewer: { id: 'bookmark-user' } }
        : { authorized: false, statusCode: 403, code: 'room_membership_required' };
    }
  });

  const read = await app.inject({ method: 'GET', url: '/api/rooms/bookmarked/pins' });
  const write = await app.inject({ method: 'PUT', url: '/api/rooms/bookmarked/pins/message-1' });

  assert.equal(read.statusCode, 200);
  assert.equal(write.statusCode, 403);
  assert.deepEqual(calls, ['list']);
});
