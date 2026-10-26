import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import fastify from 'fastify';
import { DirectHistoryPage } from '@voice-room/shared/contracts/messages';
import type { ApiContext } from '../src/app/context.ts';
import { createDmHistoryRepository } from '../src/domains/messaging/dm-history.repository.ts';
import { createDmHistoryService, type DmHistoryRepository } from '../src/domains/messaging/dm-history.service.ts';
import { registerHistoryRoutes } from '../src/domains/messaging/history.routes.ts';
import { createMessageVisibilityService } from '../src/domains/messaging/message-visibility.service.ts';
import { createUserBlockRepository } from '../src/domains/social/user-block.repository.ts';
import { createCursorCodec } from '../src/platform/cursor-codec.ts';
import { dmCursorScopes } from '../src/domains/messaging/cursor-scopes.ts';
import { registerHttpKit } from '../src/platform/http/http-kit.ts';
import { createTestDatabase } from './db-harness.ts';
import { checked } from './helpers/checked.ts';
import { fake, storedUser } from './fakes/index.ts';

const skip = !process.env.TEST_DATABASE_URL;
const codec = createCursorCodec({ keys: ['h'.repeat(32)] });
const visibilityPolicy = createMessageVisibilityService();
const projectMessages = <T>({ messages }: { messages: T[] }) => messages;
const idsOf = (page: DirectHistoryPage) => page.messages.map(({ id }) => id);

async function setup(t: TestContext) {
  const { pool, cleanup } = await createTestDatabase(t);
  t.after(cleanup);
  await pool.query(`
    INSERT INTO users (id, login, display_name, password_hash)
    VALUES ('a', 'a', 'A', 'x'), ('b', 'b', 'B', 'x'), ('c', 'c', 'C', 'x');
    INSERT INTO friendships (id, user_a_id, user_b_id) VALUES ('ab', 'a', 'b'), ('ac', 'a', 'c');
    INSERT INTO direct_messages (id, sender_id, recipient_id, body, created_at)
    SELECT 'm' || lpad(n::text, 2, '0'), CASE WHEN n % 2 = 0 THEN 'a' ELSE 'b' END,
      CASE WHEN n % 2 = 0 THEN 'b' ELSE 'a' END, 'body ' || n, '2026-08-01T12:00:00.000123Z'
    FROM generate_series(1, 12) AS n;
    INSERT INTO direct_messages (id, sender_id, recipient_id, body)
    VALUES ('foreign', 'a', 'c', 'private');
  `);
  const repository = createDmHistoryRepository({ pool });
  const service = () => createDmHistoryService({ repository, cursorCodec: codec, visibilityPolicy, projectMessages });
  const app = fastify({ logger: false });
  t.after(() => app.close());
  registerHttpKit(app, { securityHeaders: () => ({}), recordRequest() {}, logRequest() {}, logHandlerFailure() {} });
  registerHistoryRoutes(
    app,
    fake<ApiContext>({
      resolveSession: async (request) =>
        request.headers.cookie === 'session=none'
          ? null
          : {
              user: storedUser({ id: request.headers.cookie === 'session=c' ? 'c' : 'a' })
            }
    }),
    { directs: service(), rooms: fake(), canReadRoom: async () => false }
  );
  const request = async (query: string, cookie = 'session=a', peer = 'b') =>
    app.inject({
      method: 'GET',
      url: `/api/dm/${peer}/history?${query}`,
      headers: { cookie }
    });
  const read = async (query: string, cookie?: string) => {
    const response = await request(query, cookie);
    assert.equal(response.statusCode, 200, response.body);
    return checked(DirectHistoryPage, response.json<unknown>(), 'DM anchor page');
  };
  return { pool, repository, service, request, read };
}

test(
  'DM message-ID anchor opens an older page over HTTP, with exact stable tuple and normal continuation',
  { skip },
  async (t) => {
    const { read, request, service } = await setup(t);
    const latest = await read('limit=4');
    assert.deepEqual(idsOf(latest), ['m09', 'm10', 'm11', 'm12']);
    const around = await read('mode=around&messageId=m04&limit=4');
    assert.deepEqual(idsOf(around), ['m02', 'm03', 'm04', 'm05']);
    assert.deepEqual([around.pageInfo.hasMoreBefore, around.pageInfo.hasMoreAfter], [true, true]);
    assert.deepEqual(codec.decode(around.pageInfo.around, dmCursorScopes('a', 'b').history), {
      id: 'm04',
      createdAtMicros: String(BigInt(Date.parse('2026-08-01T12:00:00Z')) * 1000n + 123n)
    });
    assert.deepEqual(idsOf(await read(`mode=before&cursor=${around.pageInfo.before}&limit=4`)), ['m01']);
    assert.deepEqual(idsOf(await read(`mode=after&cursor=${around.pageInfo.after}&limit=4`)), [
      'm06',
      'm07',
      'm08',
      'm09'
    ]);
    assert.deepEqual(
      idsOf(await read(`mode=around&cursor=${around.pageInfo.around}&messageId=foreign&limit=4`)),
      idsOf(around)
    );
    assert.equal(
      (await request(`mode=around&cursor=${around.pageInfo.around}`, 'session=a', 'c')).statusCode,
      400,
      'history cursors are thread-scoped even when both threads are accessible'
    );
    assert.equal((await request(`mode=around&cursor=${around.messages[0]?.readCursor}`)).statusCode, 400);
    assert.equal((await request('mode=before&messageId=m04')).statusCode, 400);
    assert.deepEqual(idsOf(await read('mode=latest&messageId=m04&limit=4')), idsOf(latest));
    assert.deepEqual(idsOf(await read('mode=around&messageId=m04&limit=4', 'session=new')), idsOf(around));
    assert.deepEqual(
      idsOf(
        await service().getPage({ userId: 'b', peerId: 'a', query: { mode: 'around', messageId: 'm04', limit: '4' } })
      ),
      idsOf(around)
    );
    const first = await read('mode=around&messageId=m01&limit=4');
    assert.deepEqual(idsOf(first), ['m01', 'm02', 'm03', 'm04']);
    assert.equal(first.pageInfo.hasMoreBefore, false);
    const last = await read('mode=around&messageId=m12&limit=4');
    assert.deepEqual(idsOf(last), ['m09', 'm10', 'm11', 'm12']);
    assert.equal(last.pageInfo.hasMoreAfter, false);
  }
);

test(
  'DM anchor target is thread-scoped; missing is 404, tombstone locates context without returning deleted content',
  { skip },
  async (t) => {
    const { pool, request, read } = await setup(t);
    for (const messageId of ['missing', 'foreign', "' OR 1=1 --"]) {
      const response = await request(`mode=around&messageId=${encodeURIComponent(messageId)}`);
      assert.equal(response.statusCode, 404);
      assert.equal(response.json<{ code: string }>().code, 'message_not_found');
    }
    await pool.query(`UPDATE direct_messages SET deleted_at = now() WHERE id = 'm04'`);
    const deleted = await read('mode=around&messageId=m04&limit=4');
    assert.deepEqual(idsOf(deleted), ['m02', 'm03', 'm05', 'm06']);
    assert.ok(!deleted.messages.some(({ content }) => 'text' in content && content.text === 'body 4'));
    await pool.query(`DELETE FROM direct_messages WHERE id = 'm04'`);
    assert.equal((await request('mode=around&messageId=m04')).statusCode, 404);
    for (const messageId of ['', ' ', '\u0000', 'x'.repeat(161)]) {
      const response = await request(`mode=around&messageId=${encodeURIComponent(messageId)}`);
      assert.equal(response.statusCode, 400);
    }
  }
);

test(
  'DM anchor auth and friendship denial precede target lookup, including block and new account',
  { skip },
  async (t) => {
    const { pool, request } = await setup(t);
    for (const messageId of ['m04', 'missing', 'foreign']) {
      const query = `mode=around&messageId=${messageId}`;
      assert.equal((await request(query, 'session=none')).statusCode, 401);
      assert.equal((await request(query, 'session=c')).statusCode, 403);
    }
    await createUserBlockRepository({ pool }).blockUser({ userId: 'b', targetId: 'a' });
    assert.equal((await request('mode=around&messageId=m04')).statusCode, 403);
    await pool.query(`DELETE FROM user_blocks`);
    assert.equal(
      (await request('mode=around&messageId=m04')).statusCode,
      403,
      'unblocking does not restore friendship'
    );
  }
);

test('DM service does not look up any target before authorization', async () => {
  let lookups = 0;
  const service = createDmHistoryService({
    repository: fake<DmHistoryRepository>({
      canReadThread: async () => false,
      getAnchor: async () => {
        lookups++;
        return null;
      }
    }),
    cursorCodec: codec,
    visibilityPolicy,
    projectMessages
  });
  await assert.rejects(service.getPage({ userId: 'a', peerId: 'b', query: { mode: 'around', messageId: 'm04' } }), {
    code: 'thread_forbidden',
    statusCode: 403
  });
  assert.equal(lookups, 0);
});
