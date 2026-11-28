// The support routes on a bare Fastify app with a recorded service: each
// answer and refusal keeps its status and code, and an image streams with
// no caching.

import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test, { type TestContext } from 'node:test';
import fastify, { type FastifyInstance } from 'fastify';
import { Failure } from '@voiceroom/shared/contracts/http';
import {
  SupportNoted,
  SupportRead,
  SupportReplied,
  SupportResolved,
  SupportThread,
  SupportThreadList,
  SupportUnread
} from '@voiceroom/shared/contracts/support';
import { checked } from '../../helpers/checked.ts';
import type { ApiContext } from '../../../src/app/context.ts';
import { registerSupportRoutes } from '../../../src/domains/support/support.routes.ts';
import type { SupportService } from '../../../src/domains/support/support.service.ts';
import { registerHttpKit } from '../../../src/platform/http/http-kit.ts';
import { OFFICIAL_ACCOUNT_ID } from '@voiceroom/shared/official-account';
import {
  createAdminAccountsService,
  type AdminAccountsDeps
} from '../../../src/domains/admin/admin-accounts.service.ts';
import { fake } from '../../fakes/index.ts';
import { recordingService, type Answers } from '../../helpers/recording-service.ts';

const PERSON = {
  id: 'u-1',
  login: 'kira',
  displayName: 'Кира',
  avatarUrl: null,
  avatarColorKey: 'blue',
  avatarAccent: null
};
const MESSAGE = { id: 'm', fromPerson: false, body: 'Ответ', createdAt: 1, attachments: [], staffName: 'Root' };
const NOTE = { id: 'n', body: 'Заметка', createdAt: 2, authorName: 'Root' };

function routeApp(t: TestContext, outcomes: Answers<SupportService> = {}, { staff = true } = {}) {
  const app = fastify();
  registerHttpKit(app, { securityHeaders: () => ({}), recordRequest() {}, logRequest() {}, logHandlerFailure() {} });
  const { service, seen } = recordingService<SupportService>({
    list: {
      status: 'listed',
      threads: [
        {
          person: PERSON,
          status: 'open',
          unread: true,
          lastUserMessageAt: 1,
          lastMessage: { text: 'Помогите', at: 1, fromStaff: false, hasAttachments: false }
        }
      ],
      counts: { open: 1, resolved: 0 },
      openUnread: 1
    },
    unread: { status: 'counted', openUnread: 1 },
    read: {
      status: 'read',
      person: PERSON,
      personState: 'active',
      official: { displayName: 'VoiceRoom', avatarUrl: null, avatarColorKey: 'olive', avatarAccent: null },
      threadStatus: 'open',
      resolvedAt: null,
      conversationDeleted: false,
      messages: [MESSAGE],
      notes: [NOTE]
    },
    markRead: { status: 'read', openUnread: 0 },
    reply: { status: 'sent', message: MESSAGE },
    note: { status: 'noted', note: NOTE },
    resolve: { status: 'resolved', resolvedAt: 3 },
    attachment: {
      status: 'opened',
      opened: { bytes: 3, extension: 'webp', mimeType: 'image/webp', stream: Readable.from([Buffer.from('img')]) }
    },
    ...outcomes
  });
  registerSupportRoutes(app, fake<ApiContext>({}), {
    support: service,
    staffUserId: async (_request, reply) => {
      if (staff) return 'staff-1';
      reply.code(401).send({ ok: false, error: 'Staff session required', code: 'staff_session_required' });
      return null;
    }
  });
  t.after(() => app.close());
  return { app, seen };
}

type Method = 'GET' | 'POST';
async function call(app: FastifyInstance, method: Method, url: string, payload?: object) {
  const response = await app.inject({ method, url, ...(payload === undefined ? {} : { payload }) });
  const body = response.headers['content-type']?.startsWith('application/json') ? response.json<unknown>() : null;
  return { status: response.statusCode, headers: response.headers, text: response.body, body };
}
const code = (answer: { body: unknown }) => checked(Failure, answer.body).code;

const ROUTES: Array<[Method, string, object | undefined]> = [
  ['GET', '/api/admin/support/threads?status=resolved', undefined],
  ['GET', '/api/admin/support/unread', undefined],
  ['GET', '/api/admin/support/threads/u-1', undefined],
  ['POST', '/api/admin/support/threads/u-1/read', {}],
  ['POST', '/api/admin/support/threads/u-1/reply', { text: 'Ответ' }],
  ['POST', '/api/admin/support/threads/u-1/notes', { text: 'Заметка' }],
  ['POST', '/api/admin/support/threads/u-1/resolve', {}],
  ['GET', '/api/admin/support/attachments/att-1/preview', undefined]
];

test('every route answers staff with the service result', async (t) => {
  const { app, seen } = routeApp(t);
  const list = await call(app, 'GET', '/api/admin/support/threads?status=resolved');
  assert.equal(list.status, 200);
  assert.equal(checked(SupportThreadList, list.body).counts.open, 1);
  assert.deepEqual(seen.list, ['staff-1', 'resolved']);
  await call(app, 'GET', '/api/admin/support/threads');
  assert.deepEqual(seen.list, ['staff-1', 'open']);
  assert.deepEqual(checked(SupportUnread, (await call(app, 'GET', '/api/admin/support/unread')).body), {
    ok: true,
    openUnread: 1
  });
  const thread = checked(SupportThread, (await call(app, 'GET', '/api/admin/support/threads/u-1')).body);
  assert.equal(thread.status, 'open');
  assert.equal(thread.notes[0]?.body, 'Заметка');
  assert.equal(thread.personState, 'active');
  const read = await call(app, 'POST', '/api/admin/support/threads/u-1/read', {});
  assert.deepEqual(checked(SupportRead, read.body), { ok: true, openUnread: 0 });
  assert.deepEqual(seen.markRead, ['staff-1', 'u-1']);
  const reply = await call(app, 'POST', '/api/admin/support/threads/u-1/reply', { text: 'Ответ' });
  assert.equal(checked(SupportReplied, reply.body).message.staffName, 'Root');
  assert.deepEqual(seen.reply, ['staff-1', 'u-1', 'Ответ', '']);
  // A retried answer carries its key through to messaging.
  await app.inject({
    method: 'POST',
    url: '/api/admin/support/threads/u-1/reply',
    headers: { 'idempotency-key': 'reply-key-1' },
    payload: { text: 'Ответ' }
  });
  assert.deepEqual(seen.reply, ['staff-1', 'u-1', 'Ответ', 'reply-key-1']);
  const note = await call(app, 'POST', '/api/admin/support/threads/u-1/notes', { text: 'Заметка' });
  assert.equal(checked(SupportNoted, note.body).note.id, 'n');
  const resolved = await call(app, 'POST', '/api/admin/support/threads/u-1/resolve', {});
  assert.deepEqual(checked(SupportResolved, resolved.body), {
    ok: true,
    status: 'resolved',
    resolvedAt: 3
  });
  const image = await call(app, 'GET', '/api/admin/support/attachments/att-1/preview');
  assert.equal(image.status, 200);
  assert.equal(image.headers['content-type'], 'image/webp');
  assert.equal(image.headers['cache-control'], 'private, no-store');
  assert.equal(image.text, 'img');
  assert.deepEqual(seen.attachment, ['staff-1', 'att-1', 'preview']);
});

test('without a staff session nothing reaches the service', async (t) => {
  const { app, seen } = routeApp(t, {}, { staff: false });
  for (const [method, url, payload] of ROUTES) assert.equal((await call(app, method, url, payload)).status, 401, url);
  assert.deepEqual(seen, {});
});

test('refusals keep their statuses and codes', async (t) => {
  const forbidden = routeApp(t, {
    list: { status: 'forbidden' },
    unread: { status: 'forbidden' },
    read: { status: 'forbidden' },
    markRead: { status: 'forbidden' },
    reply: { status: 'forbidden' },
    note: { status: 'forbidden' },
    resolve: { status: 'forbidden' },
    attachment: { status: 'forbidden' }
  });
  for (const [method, url, payload] of ROUTES) {
    const answer = await call(forbidden.app, method, url, payload);
    assert.equal(answer.status, 403, url);
    assert.equal(code(answer), 'forbidden', url);
  }

  const missing = routeApp(t, {
    read: { status: 'not_found' },
    markRead: { status: 'not_found' },
    reply: { status: 'not_found' },
    note: { status: 'not_found' },
    resolve: { status: 'not_found' }
  });
  for (const [method, url, payload] of ROUTES.slice(2, 7)) {
    const answer = await call(missing.app, method, url, payload);
    assert.equal(answer.status, 404, url);
    assert.equal(code(answer), 'support_thread_not_found', url);
  }

  const changed = routeApp(t, { resolve: { status: 'changed' } });
  const stale = await call(changed.app, 'POST', '/api/admin/support/threads/u-1/resolve', {});
  assert.equal(stale.status, 409);
  assert.equal(code(stale), 'support_thread_changed');

  const empty = routeApp(t, { reply: { status: 'empty' }, note: { status: 'empty' } });
  for (const path of ['reply', 'notes']) {
    const answer = await call(empty.app, 'POST', `/api/admin/support/threads/u-1/${path}`, { text: ' ' });
    assert.equal(answer.status, 400);
    assert.equal(code(answer), 'empty_message');
  }
  // The schema refuses an empty or missing text before the service.
  assert.equal((await call(empty.app, 'POST', '/api/admin/support/threads/u-1/reply', { text: '' })).status, 400);
  assert.equal((await call(empty.app, 'GET', '/api/admin/support/threads?status=closed')).status, 400);

  const limited = routeApp(t, { reply: { status: 'rate_limited', retryAfterSeconds: 7 } });
  const tooMany = await call(limited.app, 'POST', '/api/admin/support/threads/u-1/reply', { text: 'Ответ' });
  assert.equal(tooMany.status, 429);
  assert.equal(tooMany.headers['retry-after'], '7');
  assert.equal(code(tooMany), 'message_rate_limited');
  assert.equal(checked(Failure, tooMany.body).retryAfterSeconds, 7);

  const gone = routeApp(t, { reply: { status: 'official_missing' } });
  const unavailable = await call(gone.app, 'POST', '/api/admin/support/threads/u-1/reply', { text: 'Ответ' });
  assert.equal(unavailable.status, 503);
  assert.equal(code(unavailable), 'account_not_found');
});

test('staff actions on the official account are refused before they run', async () => {
  const touched = new Array<string>();
  const accounts = createAdminAccountsService(
    fake<AdminAccountsDeps>({
      staff: { can: async () => true, memberIds: async () => [] },
      standing: () =>
        fake<ReturnType<AdminAccountsDeps['standing']>>({
          block: async () => {
            touched.push('block');
            return 'updated';
          },
          setBadge: async () => {
            touched.push('badge');
            return true;
          }
        })
    })
  );
  assert.deepEqual(await accounts.block('staff-1', OFFICIAL_ACCOUNT_ID, { duration: 'forever', reason: 'spam' }), {
    status: 'official_account'
  });
  assert.deepEqual(await accounts.signOutEverywhere('staff-1', OFFICIAL_ACCOUNT_ID), { status: 'official_account' });
  assert.deepEqual(await accounts.remove('staff-1', OFFICIAL_ACCOUNT_ID, { login: 'voiceroom', reason: 'spam' }), {
    status: 'official_account'
  });
  assert.deepEqual(await accounts.setBadge('staff-1', OFFICIAL_ACCOUNT_ID, null), { status: 'official_account' });
  assert.deepEqual(touched, []);
});
