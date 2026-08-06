'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createCursorCodec } = require('../src/platform/cursor-codec');
const { createReactionService } = require('../src/domains/messaging/reaction-service');
const { registerReactionRoutes } = require('../src/domains/messaging/reaction-routes');
const { createReactionRealtimeAdapter } = require('../src/domains/messaging/reaction-realtime-adapter');
const fs = require('node:fs');

function repository() {
  let active = false;
  let revision = 0n;
  return {
    async listSummaries() { return active ? [{ emoji: '😀', count: 1, reactedByMe: false, revision: String(revision) }] : []; },
    async listReactors({ limit }) {
      return Array.from({ length: Math.min(limit, 101) }, (_, index) => ({
        userId: `u-${index}`, displayName: `User ${index}`, avatarUrl: null,
        cursorTuple: { createdAtMicros: String(index), id: `u-${index}` }
      }));
    },
    async setDesiredState({ active: desired }) {
      if (active === desired) return { changed: false, revision: String(revision) };
      active = desired;
      revision += 1n;
      return { changed: true, revision: String(revision) };
    },
    async getSummary({ userId }) { return { emoji: '😀', count: active ? 1 : 0, reactedByMe: active && userId === 'account', revision: String(revision) }; },
    async transaction(callback) { return callback(); }
  };
}

function service(overrides = {}) {
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
  assert.deepEqual(await reactions.getSummaries({ conversation: { type: 'room', id: 'room' }, messageId: 'm', viewer: guest }), []);
  await assert.rejects(reactions.setDesired({
    conversation: { type: 'room', id: 'room' }, mutation: { messageId: 'm', emoji: '😀', active: true }, viewer: guest
  }), (error) => error.statusCode === 403 && error.code === 'account_required');
  for (const messageId of ['deleted', 'hidden']) {
    await assert.rejects(reactions.getSummaries({ conversation: { type: 'room', id: 'room' }, messageId, viewer: guest }), (error) => error.statusCode === 404);
  }
  await assert.rejects(reactions.getSummaries({ conversation: { type: 'room', id: 'other' }, messageId: 'm', viewer: guest }), (error) => error.statusCode === 404);
  await assert.rejects(reactions.getSummaries({ conversation: { type: 'dm', id: 'peer' }, messageId: 'm', viewer: { id: 'outsider' } }), (error) => error.statusCode === 404);

  const first = await reactions.getReactors({ conversation: { type: 'room', id: 'room' }, messageId: 'm', emoji: '😀', query: {}, viewer: guest });
  assert.equal(first.reactors.length, 50);
  assert.ok(first.nextCursor);
  await assert.rejects(reactions.getReactors({ conversation: { type: 'room', id: 'other' }, messageId: 'm', emoji: '😀', query: { cursor: first.nextCursor }, viewer: guest }));
});

test('G69-A02 desired PUT is idempotent, bounded, revisioned and publishes only changes', async () => {
  const published = [];
  const reactions = service({ publish: async (event) => published.push(event) });
  const viewer = { id: 'account' };
  const timings = [];
  for (let index = 0; index < 40; index += 1) {
    const started = performance.now();
    const summary = await reactions.setDesired({
      conversation: { type: 'room', id: 'room' }, mutation: { messageId: 'm', emoji: '😀', active: true }, viewer
    });
    timings.push(performance.now() - started);
    assert.equal(summary.count, 1);
    assert.match(summary.revision, /^\d+$/);
  }
  timings.sort((a, b) => a - b);
  assert.ok(timings[Math.floor(timings.length * 0.95)] <= 250);
  assert.equal(published.length, 1);

  const roomEvents = [];
  const accountEvents = [];
  const realtime = createReactionRealtimeAdapter({
    broadcastRoom: async (id, event) => roomEvents.push([id, event]),
    broadcastAccount: (id, event) => accountEvents.push([id, event]),
    resolveDirectRecipients: async () => ['account', 'peer', 'account']
  });
  await realtime.publish({ conversation: { type: 'room', id: 'room' }, messageId: 'm', summary: { emoji: '😀', count: 1, reactedByMe: true, revision: '1' } });
  await realtime.publish({ conversation: { type: 'dm', id: 'peer' }, actorUserId: 'account', messageId: 'm', summary: { emoji: '😀', count: 1, reactedByMe: true, revision: '1' } });
  assert.equal(roomEvents.length, 1);
  assert.deepEqual(accountEvents.map(([id]) => id).sort(), ['account', 'peer']);
});

test('G69 routes preserve no-store reads and service authorization status', async () => {
  const handlers = {};
  const app = { get(path, handler) { handlers[`GET ${path}`] = handler; }, put(path, handler) { handlers[`PUT ${path}`] = handler; } };
  registerReactionRoutes({ app, reactionService: service(), resolveUser: async (request) => request.viewer });
  const reply = () => ({ status: 0, headers: {}, header(name, value) { this.headers[name] = value; return this; }, code(value) { this.status = value; return this; }, send(value) { this.body = value; return this; } });
  const request = { params: { type: 'room', conversationId: 'room', messageId: 'm' }, query: {}, body: { emoji: '😀', active: true }, viewer: { id: 'guest', guest: true } };
  const readReply = reply();
  await handlers['GET /api/reactions/:type/:conversationId/:messageId'](request, readReply);
  assert.equal(readReply.status, 200);
  assert.equal(readReply.headers['Cache-Control'], 'no-store');
  const writeReply = reply();
  await handlers['PUT /api/reactions/:type/:conversationId/:messageId'](request, writeReply);
  assert.equal(writeReply.status, 403);
  const server = fs.readFileSync('apps/api/src/server.js', 'utf8');
  assert.match(server, /operation === 'read' && !viewer\?\.id/);
  assert.match(server, /canUserReadRoomChat/);
});
