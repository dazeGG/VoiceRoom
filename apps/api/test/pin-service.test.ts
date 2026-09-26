import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { Pool } from 'pg';

import { createPinRepository } from '../src/domains/messaging/pin.repository.ts';
import { createPinService, type PinEvent } from '../src/domains/messaging/pin.service.ts';
import { registerPinRoutes } from '../src/domains/messaging/pins.routes.ts';
import type { ApiContext } from '../src/app/context.ts';
import { fake, storedUser } from './fakes/index.ts';
import { createRoomStore } from '../src/lib/room-store.ts';
import { createUserStore } from '../src/lib/user-store.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };

async function createPinFixture(t: TestContext) {
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  await runMigrations({ databaseUrl, logger: SILENT });
  const pool = new Pool({ connectionString: databaseUrl, max: 12 });
  const users = createUserStore({ pool, logger: SILENT });
  const rooms = createRoomStore({ pool });
  const created = await users.createUser({ login: 'pin-user', displayName: 'Pin User', password: 'password123' });
  const user = created.user;
  assert.ok(user);
  const room = await rooms.createRoom({ roomId: 'pin-room', creatorIp: '127.0.0.1', ownerId: user.id, isStatic: true });
  assert.ok(room);
  t.after(async () => {
    await pool.end();
    await cleanup();
  });
  return { pool, repository: createPinRepository({ client: pool }), room, rooms, user };
}

/** A stored room message by the fixture's user. */
async function append(fixture: Awaited<ReturnType<typeof createPinFixture>>, peerId: string, text: string) {
  const message = await fixture.rooms.appendMessage(fixture.room.id, { authorUserId: fixture.user.id, peerId, text });
  assert.ok(message);
  return message;
}

test('51 concurrent distinct pins preserve the 50-pin room cap', async (t) => {
  const fixture = await createPinFixture(t);
  const service = createPinService({ repository: fixture.repository });
  const messages = await Promise.all(
    Array.from({ length: 51 }, (_, index) => append(fixture, `peer-${index}`, `message-${index}`))
  );

  const results = await Promise.allSettled(
    messages.map((message) =>
      service.pin({
        roomId: fixture.room.id,
        messageId: message.id,
        viewer: fixture.user
      })
    )
  );

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 50);
  const rejection = results.find((result) => result.status === 'rejected');
  assert.equal((rejection?.reason as { code?: string } | undefined)?.code, 'pin_limit_reached');
  assert.equal((await service.list({ roomId: fixture.room.id })).count, 50);
});

test('pin refresh publishes edited message text', async (t) => {
  const fixture = await createPinFixture(t);
  const events: PinEvent[] = [];
  const service = createPinService({ repository: fixture.repository, publish: async (event) => events.push(event) });
  const message = await append(fixture, 'peer-edit', 'before');
  await service.pin({ roomId: fixture.room.id, messageId: message.id, viewer: fixture.user });

  await fixture.pool.query(`UPDATE room_messages SET text = 'after' WHERE id = $1`, [message.id]);
  const refreshed = await service.refresh({ roomId: fixture.room.id, action: 'message-edited', messageId: message.id });

  assert.equal(refreshed.pins[0]?.text, 'after');
  assert.equal(events.at(-1)?.pins[0]?.text, 'after');
});

test('pin refresh removes soft-deleted messages from the snapshot', async (t) => {
  const fixture = await createPinFixture(t);
  const service = createPinService({ repository: fixture.repository });
  const message = await append(fixture, 'peer-delete', 'delete me');
  await service.pin({ roomId: fixture.room.id, messageId: message.id, viewer: fixture.user });

  await fixture.pool.query(`UPDATE room_messages SET deleted_at = now() WHERE id = $1`, [message.id]);
  const refreshed = await service.refresh({
    roomId: fixture.room.id,
    action: 'message-deleted',
    messageId: message.id
  });

  assert.deepEqual(refreshed, { pins: [], count: 0 });
});

test('bookmark access can read pins but cannot mutate them without membership', async (t) => {
  const app = Fastify({ logger: false });
  t.after(() => app.close());
  const calls: unknown[] = [];
  registerPinRoutes(
    app,
    fake<ApiContext>({ resolveSession: async () => ({ user: storedUser({ id: 'bookmark-user' }) }) }),
    {
      pins: {
        async list() {
          calls.push('list');
          return { pins: [], count: 0 };
        },
        async pin() {
          calls.push('pin');
          return { pins: [], count: 0 };
        },
        async unpin() {
          calls.push('unpin');
          return { pins: [], count: 0 };
        }
      },
      // A bookmark may read the pins but not change them.
      canRead: async () => true,
      canWrite: async () => false
    }
  );

  const read = await app.inject({ method: 'GET', url: '/api/rooms/bookmarked/pins' });
  const write = await app.inject({ method: 'PUT', url: '/api/rooms/bookmarked/pins/message-1' });

  assert.equal(read.statusCode, 200);
  assert.equal(write.statusCode, 403);
  assert.deepEqual(calls, ['list']);
});
