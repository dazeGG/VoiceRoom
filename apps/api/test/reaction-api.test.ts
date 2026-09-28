import assert from 'node:assert/strict';
import fastify from 'fastify';
import test from 'node:test';
import { createCursorCodec } from '../src/platform/cursor-codec.ts';
import { createReactionService, type ReactionRepository } from '../src/domains/messaging/reaction.service.ts';
import { registerReactionRoutes } from '../src/domains/messaging/reactions.routes.ts';
import type { ApiContext } from '../src/app/context.ts';
import { fake } from './fakes/index.ts';
import { registerHttpKit } from '../src/platform/http/http-kit.ts';
import { createReactionRealtimeAdapter } from '../src/domains/messaging/reaction-realtime-adapter.ts';

function repository(): ReactionRepository {
  let active = false;
  let revision = 0n;
  return {
    async listSummaries() {
      return active ? [{ emoji: '😀', count: 1, reactedByMe: false, revision: String(revision) }] : [];
    },
    async listReactors({ limit }) {
      return Array.from({ length: Math.min(limit, 101) }, (_, index) => ({
        userId: `u-${index}`,
        displayName: `User ${index}`,
        avatarUrl: null,
        cursorTuple: { createdAtMicros: String(index), id: `u-${index}` }
      }));
    },
    async setDesiredState({ active: desired }) {
      if (active === desired) return { changed: false, revision: String(revision) };
      active = desired;
      revision += 1n;
      return { changed: true, revision: String(revision) };
    },
    async getSummary({ userId }) {
      return {
        emoji: '😀',
        count: active ? 1 : 0,
        reactedByMe: active && userId === 'account',
        revision: String(revision)
      };
    },
    async transaction(callback) {
      return callback(null);
    }
  };
}

function service(overrides: Partial<Parameters<typeof createReactionService>[0]> = {}) {
  return createReactionService({
    repository: repository(),
    cursorCodec: createCursorCodec({ keys: ['reaction-test-secret-must-be-at-least-32-bytes'] }),
    writesEnabled: true,
    requireVisible: async ({ conversation, messageId, viewer }) => {
      if (messageId === 'deleted' || messageId === 'hidden') return false;
      if (conversation.type === 'dm') return viewer?.id === 'account' && conversation.id === 'peer';
      return conversation.id === 'room' && Boolean(viewer?.id);
    },
    ...overrides
  });
}

test('G69-A01 guest room reads are authorized, mutation is 403, and DM/cross-context data fails closed', async () => {
  const reactions = service();
  const guest = { id: 'guest-principal', guest: true };
  assert.deepEqual(
    await reactions.getSummaries({ conversation: { type: 'room', id: 'room' }, messageId: 'm', viewer: guest }),
    []
  );
  await assert.rejects(
    reactions.setDesired({
      conversation: { type: 'room', id: 'room' },
      mutation: { messageId: 'm', emoji: '😀', active: true },
      viewer: guest
    }),
    { statusCode: 403, code: 'account_required' }
  );
  for (const messageId of ['deleted', 'hidden']) {
    await assert.rejects(
      reactions.getSummaries({ conversation: { type: 'room', id: 'room' }, messageId, viewer: guest }),
      { statusCode: 404 }
    );
  }
  await assert.rejects(
    reactions.getSummaries({ conversation: { type: 'room', id: 'other' }, messageId: 'm', viewer: guest }),
    { statusCode: 404 }
  );
  await assert.rejects(
    reactions.getSummaries({ conversation: { type: 'dm', id: 'peer' }, messageId: 'm', viewer: { id: 'outsider' } }),
    { statusCode: 404 }
  );

  const first = await reactions.getReactors({
    conversation: { type: 'room', id: 'room' },
    messageId: 'm',
    emoji: '😀',
    query: {},
    viewer: guest
  });
  assert.equal(first.reactors.length, 50);
  assert.ok(first.nextCursor);
  await assert.rejects(
    reactions.getReactors({
      conversation: { type: 'room', id: 'other' },
      messageId: 'm',
      emoji: '😀',
      query: { cursor: first.nextCursor },
      viewer: guest
    })
  );
});

test('G69-A02 desired PUT is idempotent, bounded, revisioned and publishes only changes', async () => {
  const published: unknown[] = [];
  const reactions = service({ publish: async (event) => published.push(event) });
  const viewer = { id: 'account' };
  const timings: number[] = [];
  for (let index = 0; index < 40; index += 1) {
    const started = performance.now();
    const summary = await reactions.setDesired({
      conversation: { type: 'room', id: 'room' },
      mutation: { messageId: 'm', emoji: '😀', active: true },
      viewer
    });
    timings.push(performance.now() - started);
    assert.equal(summary.count, 1);
    assert.match(summary.revision, /^\d+$/);
  }
  timings.sort((a, b) => a - b);
  assert.ok((timings[Math.floor(timings.length * 0.95)] ?? 0) <= 250);
  assert.equal(published.length, 1);

  const roomEvents: unknown[] = [];
  const accountEvents: Array<[string, unknown]> = [];
  const realtime = createReactionRealtimeAdapter({
    broadcastRoom: async (id, event) => roomEvents.push([id, event]),
    broadcastAccount: (id, event) => accountEvents.push([id, event]),
    resolveDirectRecipients: async () => ['account', 'peer', 'account']
  });
  await realtime.publish({
    conversation: { type: 'room', id: 'room' },
    messageId: 'm',
    summary: { emoji: '😀', count: 1, reactedByMe: true, revision: '1' }
  });
  await realtime.publish({
    conversation: { type: 'dm', id: 'peer' },
    actorUserId: 'account',
    messageId: 'm',
    summary: { emoji: '😀', count: 1, reactedByMe: true, revision: '1' }
  });
  assert.equal(roomEvents.length, 1);
  assert.deepEqual(accountEvents.map(([id]) => id).sort(), ['account', 'peer']);

  let release: (value: unknown) => void = () => {};
  let settled = false;
  const ordered = createReactionRealtimeAdapter({
    broadcastRoom: () =>
      new Promise((resolve) => {
        release = resolve;
      })
  });
  const pending = ordered
    .publish({
      conversation: { type: 'room', id: 'room' },
      messageId: 'm',
      summary: { emoji: '😀', count: 1, reactedByMe: true, revision: '2' }
    })
    .then(() => {
      settled = true;
    });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  release(true);
  await pending;
  assert.equal(settled, true);
});

test('G69 routes preserve no-store reads and service authorization status', async (t) => {
  const app = fastify();
  t.after(() => app.close());
  // Every route answers no-store through the HTTP kit, as in the server.
  registerHttpKit(app, { securityHeaders: () => ({}), recordRequest() {}, logRequest() {}, logHandlerFailure() {} });
  // A guest has no session: a visible room's reactions read fine, writing needs an account.
  registerReactionRoutes(app, fake<ApiContext>({ resolveSession: async () => null }), {
    reactions: service({ requireVisible: async ({ conversation }) => conversation.id === 'room' })
  });
  const url = '/api/reactions/room/room/m';
  const read = await app.inject({ method: 'GET', url });
  assert.equal(read.statusCode, 200);
  assert.equal(read.headers['cache-control'], 'no-store');
  const write = await app.inject({ method: 'PUT', url, payload: { emoji: '😀', active: true } });
  assert.equal(write.statusCode, 403);
});
