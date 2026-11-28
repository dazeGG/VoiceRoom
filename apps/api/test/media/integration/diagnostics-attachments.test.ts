// The diagnostics file against a real server: a slot reserved for it takes one
// plain-text file under its own name (nothing else, and no image), becomes
// ready without the media worker, counts in the owner's quota, binds only into
// a conversation with the official VoiceRoom account, and downloads (by the
// two people and by support staff) as an attachment the browser must not sniff.
// Deleting the conversation revokes it like any attachment. Every other
// non-image upload stays refused.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { sql } from 'kysely';
import { SignedIn } from '@voiceroom/shared/contracts/account';
import { AttachmentAnswer } from '@voiceroom/shared/contracts/media';
import { DirectMessageAnswer, DirectThread } from '@voiceroom/shared/contracts/messages';
import { SupportThread } from '@voiceroom/shared/contracts/support';
import { OFFICIAL_ACCOUNT_ID } from '@voiceroom/shared/official-account';
import { createApiRuntime } from '../../../src/app/api-runtime.ts';
import { createTestDatabase } from '../../db-harness.ts';
import { createAttachmentRepository } from '../../../src/domains/media/attachment.repository.ts';
import { createMediaJobRepository } from '../../../src/domains/media/media-job.repository.ts';
import { createMediaMaintenanceService } from '../../../src/domains/media/media-maintenance.service.ts';
import { createMediaStorage } from '../../../src/domains/media/storage.ts';
import { hashPassword } from '../../../src/lib/password.ts';
import { kyselyOn, withTransaction } from '../../../src/platform/db/kysely.ts';
import { DIAGNOSTICS_REPORT as REPORT } from '../../fakes/diagnostics-report.ts';
import {
  acceptFirstFriendRequest,
  cookieFrom,
  request,
  sendFriendRequest,
  socketDir
} from '../../fakes/server-process.ts';
import { staffCookie } from '../../staff-session.ts';

const skip = !process.env.TEST_DATABASE_URL;
const ROOT_ID = '00000000-0000-4000-8000-0000000000ad';
const NAME = 'voiceroom-diagnostics-2026-11-27-1402.txt';

type Account = { id: string; cookie: string };

function multipart(name: string, type: string, content: Buffer) {
  const boundary = `----vr${randomUUID().replaceAll('-', '')}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`
  );
  return {
    rawBody: Buffer.concat([head, content, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }
  };
}

/** A GET whose body is not JSON: the status, the headers and the bytes. */
function download(socketPath: string, pathname: string, cookie: string) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.request({ path: pathname, socketPath, headers: { Cookie: cookie } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') })
      );
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

async function setup(t: TestContext) {
  const { dir, socketPath } = socketDir('voice-room-diagnostics-');
  const storageDir = path.join(dir, 'storage');
  await fs.promises.mkdir(storageDir);
  const { databaseUrl, pool, cleanup } = await createTestDatabase(t);
  const runtime = createApiRuntime({
    env: {
      NODE_ENV: 'test',
      AUTH_RATE_LIMIT: '0',
      DM_RATE_LIMIT: '0',
      MEDIA_STORAGE_DIR: storageDir,
      PLATFORM_ADMIN_USER_IDS: ROOT_ID
    }
  });
  runtime.services.connect({ databaseUrl });
  const app = runtime.createApp();
  t.after(async () => {
    await app.close();
    await runtime.closeStores();
    await cleanup();
    await fs.promises.rm(dir, { recursive: true, force: true });
  });
  await app.listen({ path: socketPath });

  async function account(login: string): Promise<Account> {
    const response = await request(
      socketPath,
      {
        method: 'POST',
        pathname: '/api/auth/register',
        body: { login, displayName: login, password: 'password123', passwordConfirm: 'password123' }
      },
      SignedIn
    );
    assert.equal(response.status, 201);
    return { id: response.body.user.id, cookie: cookieFrom(response.setCookie) };
  }
  const alice = await account('alice');
  const bob = await account('bob');
  await sendFriendRequest(socketPath, alice.cookie, 'bob');
  await acceptFirstFriendRequest(socketPath, bob.cookie);

  async function signInStaff() {
    await pool.query(`INSERT INTO users (id, login, display_name, password_hash) VALUES ($1, 'root', 'Root', $2)`, [
      ROOT_ID,
      await hashPassword('password123')
    ]);
    const signedIn = await request(socketPath, {
      method: 'POST',
      pathname: '/api/auth/login',
      body: { login: 'root', password: 'password123' }
    });
    const cookie = await staffCookie(socketPath, cookieFrom(signedIn.setCookie));
    assert.ok(cookie);
    return cookie;
  }

  const slot = (who: Account, body: Record<string, unknown>) =>
    request(socketPath, {
      method: 'POST',
      pathname: '/api/media/attachments',
      cookie: who.cookie,
      body: { clientRequestId: randomUUID(), ...body }
    });
  const reserve = async (who: Account, bytes: number) => {
    const reserved = await request(
      socketPath,
      {
        method: 'POST',
        pathname: '/api/media/attachments',
        cookie: who.cookie,
        body: { context: 'dm', kind: 'diagnostics', clientRequestId: randomUUID(), bytes }
      },
      AttachmentAnswer
    );
    assert.equal(reserved.status, 201);
    return reserved.body.attachment;
  };
  const upload = (who: Account, id: string, name: string, type: string, content: Buffer) =>
    request(socketPath, {
      method: 'PUT',
      pathname: `/api/media/attachments/${id}/content`,
      cookie: who.cookie,
      ...multipart(name, type, content)
    });
  /** A ready diagnostics file of the account's. */
  const ready = async (who: Account, content = Buffer.from(REPORT)) => {
    const draft = await reserve(who, content.length);
    const uploaded = await request(
      socketPath,
      {
        method: 'PUT',
        pathname: `/api/media/attachments/${draft.id}/content`,
        cookie: who.cookie,
        ...multipart(NAME, 'text/plain', content)
      },
      AttachmentAnswer
    );
    assert.equal(uploaded.status, 200);
    return uploaded.body.attachment;
  };
  const send = (from: Account, to: string, attachmentIds: string[]) =>
    request(socketPath, {
      method: 'POST',
      pathname: `/api/dm/${to}`,
      cookie: from.cookie,
      body: { text: 'Звук пропадает', attachmentIds, idempotencyKey: randomUUID() }
    });
  const state = async (id: string) =>
    (await pool.query<{ state: string }>('SELECT state FROM message_attachments WHERE id = $1', [id])).rows[0]?.state;
  return { socketPath, storageDir, pool, alice, bob, slot, reserve, upload, ready, send, state, signInStaff };
}

test(
  'a diagnostics file is accepted as text, sent to VoiceRoom and downloaded as an attachment',
  { skip },
  async (t) => {
    const { socketPath, pool, alice, bob, ready, send, signInStaff } = await setup(t);
    const db = kyselyOn(pool);
    const usage = () => createAttachmentRepository({ pool }).quotaUsage(alice.id);
    const before = (await usage()).usedBytes;

    const file = await ready(alice);
    assert.deepEqual(
      {
        state: file.state,
        kind: file.kind,
        name: file.name,
        mime: file.mimeType,
        bytes: file.bytes,
        width: file.width
      },
      {
        state: 'ready',
        kind: 'diagnostics',
        name: NAME,
        mime: 'text/plain',
        bytes: Buffer.byteLength(REPORT),
        width: null
      }
    );
    // Ready without the media worker, and counted in the owner's quota.
    assert.equal((await usage()).usedBytes, before + Buffer.byteLength(REPORT));
    const jobs = await pool.query<{ found: number }>(
      'SELECT 1 AS found FROM media_processing_jobs WHERE attachment_id = $1',
      [file.id]
    );
    assert.equal(jobs.rowCount, 0);

    const sent = await request(
      socketPath,
      {
        method: 'POST',
        pathname: `/api/dm/${OFFICIAL_ACCOUNT_ID}`,
        cookie: alice.cookie,
        body: { text: 'Звук пропадает', attachmentIds: [file.id], idempotencyKey: randomUUID() }
      },
      DirectMessageAnswer
    );
    assert.equal(sent.status, 201);
    const [attachment] = sent.body.message.attachments ?? [];
    assert.deepEqual(attachment, {
      id: file.id,
      context: 'dm',
      order: 0,
      mimeType: 'text/plain',
      bytes: Buffer.byteLength(REPORT),
      width: null,
      height: null,
      state: 'ready',
      url: `/api/media/attachments/${file.id}/file`,
      kind: 'diagnostics',
      name: NAME
    });
    const thread = await request(
      socketPath,
      { pathname: `/api/dm/${OFFICIAL_ACCOUNT_ID}`, cookie: alice.cookie },
      DirectThread
    );
    assert.equal(thread.body.messages.at(-1)?.attachments?.[0]?.kind, 'diagnostics');

    const got = await download(socketPath, `/api/media/attachments/${file.id}/file`, alice.cookie);
    assert.equal(got.status, 200);
    assert.equal(got.body, REPORT);
    assert.equal(got.headers['content-disposition'], `attachment; filename="${NAME}"`);
    assert.equal(got.headers['x-content-type-options'], 'nosniff');
    assert.equal(got.headers['content-type'], 'text/plain; charset=utf-8');
    assert.equal(got.headers['content-length'], String(Buffer.byteLength(REPORT)));
    // A file has no image variants, and an image has no file; outsiders see nothing.
    for (const variant of ['preview', 'processed', 'original']) {
      assert.equal(
        (await download(socketPath, `/api/media/attachments/${file.id}/${variant}`, alice.cookie)).status,
        404
      );
    }
    assert.equal((await download(socketPath, `/api/media/attachments/${file.id}/file`, bob.cookie)).status, 404);

    // Support staff download it from the inbox, under the same headers.
    const staff = await signInStaff();
    const inbox = await request(
      socketPath,
      { pathname: `/api/admin/support/threads/${alice.id}`, cookie: staff },
      SupportThread
    );
    assert.equal(inbox.status, 200);
    const row = inbox.body.messages.at(-1)?.attachments[0];
    assert.deepEqual(row, {
      id: file.id,
      kind: 'diagnostics',
      mimeType: 'text/plain',
      width: null,
      height: null,
      name: NAME,
      bytes: Buffer.byteLength(REPORT),
      url: `/api/admin/support/attachments/${file.id}/file`
    });
    const staffCopy = await download(socketPath, row?.url ?? '', staff);
    assert.equal(staffCopy.status, 200);
    assert.equal(staffCopy.body, REPORT);
    assert.equal(staffCopy.headers['content-disposition'], `attachment; filename="${NAME}"`);
    assert.equal(staffCopy.headers['x-content-type-options'], 'nosniff');

    const staffUrl = `/api/admin/support/attachments/${file.id}/file`;
    assert.equal((await download(socketPath, staffUrl, bob.cookie)).status, 403);
    await db.updateTable('users').set({ staff_role: 'moderator' }).where('id', '=', bob.id).execute();
    const moderator = await staffCookie(socketPath, bob.cookie);
    assert.ok(moderator, 'The moderator has an active staff session');
    assert.equal((await request(socketPath, { pathname: '/api/staff/me', cookie: moderator })).status, 200);
    assert.equal((await download(socketPath, staffUrl, moderator)).status, 403);

    // Anything but the official pair is refused with its own code, and the file stays a draft.
    const other = await ready(alice);
    const bobs = await ready(bob);
    const crossOwner = await send(bob, OFFICIAL_ACCOUNT_ID, [bobs.id, other.id]);
    assert.deepEqual([crossOwner.status, crossOwner.body.code], [400, 'invalid_attachments']);
    assert.equal(
      await db.selectFrom('direct_messages').select('id').where('sender_id', '=', bob.id).executeTakeFirst(),
      undefined
    );
    const untouched = await db
      .selectFrom('message_attachments')
      .select(['direct_message_id', 'attachment_order', 'bound_at'])
      .where('id', 'in', [other.id, bobs.id])
      .execute();
    assert.deepEqual(
      untouched,
      Array.from({ length: 2 }, () => ({
        direct_message_id: null,
        attachment_order: null,
        bound_at: null
      }))
    );

    const refused = await send(alice, bob.id, [other.id]);
    assert.equal(refused.status, 403);
    assert.equal(refused.body.code, 'media_diagnostics_official_only');
    assert.equal(
      (
        await pool.query<{ bound_at: Date | null }>('SELECT bound_at FROM message_attachments WHERE id = $1', [
          other.id
        ])
      ).rows[0]?.bound_at,
      null
    );
  }
);

test('the diagnostics slot takes only a named UTF-8 text file within 512 KiB', { skip }, async (t) => {
  const { alice, slot, reserve, upload, state, storageDir } = await setup(t);
  const body = Buffer.from(REPORT);

  // The slot itself: a direct message only, and within the file limit.
  const inRoom = await slot(alice, { context: 'room', kind: 'diagnostics', bytes: 10 });
  assert.deepEqual([inRoom.status, inRoom.body.code], [400, 'media_diagnostics_invalid']);
  const tooBig = await slot(alice, { context: 'dm', kind: 'diagnostics', bytes: 512 * 1024 + 1 });
  assert.deepEqual([tooBig.status, tooBig.body.code], [413, 'media_too_large']);
  const unknown = await slot(alice, { context: 'dm', kind: 'video', bytes: 10 });
  assert.deepEqual([unknown.status, unknown.body.code], [415, 'media_type_unsupported']);

  const cases: Array<[string, string, Buffer, number, string]> = [
    ['notes.txt', 'text/plain', body, 400, 'media_diagnostics_invalid'],
    [NAME, 'text/html', body, 400, 'media_diagnostics_invalid'],
    [NAME, 'text/plain', Buffer.from([0xff, 0xfe, 0x00, 0x41]), 400, 'media_diagnostics_invalid'],
    [NAME, 'text/plain', Buffer.from('a\u0000b'), 400, 'media_diagnostics_invalid'],
    [NAME, 'text/plain', Buffer.from('Unrelated plain text'), 400, 'media_diagnostics_invalid'],
    [NAME, 'text/plain', Buffer.from('<!doctype html><p>Notes</p>'), 400, 'media_diagnostics_invalid'],
    [NAME, 'text/plain', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 400, 'media_diagnostics_invalid'],
    [
      NAME,
      'text/plain',
      Buffer.from(REPORT.replace('Microphone: USB device', 'Microphone: <b>USB device</b>')),
      400,
      'media_diagnostics_invalid'
    ],
    [NAME, 'text/plain', Buffer.from(REPORT.replace('USB device', 'USB\x1bdevice')), 400, 'media_diagnostics_invalid'],
    [
      NAME,
      'text/plain',
      Buffer.from(REPORT.replace('diagnostics v1', 'diagnostics v2')),
      400,
      'media_diagnostics_invalid'
    ],
    [
      NAME,
      'text/plain',
      Buffer.from(REPORT.replace('elapsedMs=42', 'elapsedMs=1e+309')),
      400,
      'media_diagnostics_invalid'
    ],
    [NAME, 'text/plain', Buffer.alloc(0), 400, 'media_diagnostics_invalid']
  ];
  for (const [name, type, content, status, code] of cases) {
    const draft = await reserve(alice, Math.max(content.length, 1));
    const refused = await upload(alice, draft.id, name, type, content);
    assert.deepEqual([refused.status, refused.body.code], [status, code], `${name} ${type}`);
    assert.equal(await state(draft.id), 'failed');
    assert.equal(fs.existsSync(path.join(storageDir, draft.id, 'original')), false);
  }

  // A file over the limit stops at 512 KiB, whatever the slot claimed.
  const draft = await reserve(alice, 512 * 1024);
  const large = await upload(alice, draft.id, NAME, 'text/plain', Buffer.alloc(512 * 1024 + 10, 0x61));
  assert.deepEqual([large.status, large.body.code], [413, 'media_too_large']);
  assert.equal(await state(draft.id), 'failed');

  // A file larger than its reservation is refused too.
  const small = await reserve(alice, 4);
  const over = await upload(alice, small.id, NAME, 'text/plain', body);
  assert.deepEqual([over.status, over.body.code], [413, 'media_size_mismatch']);
});

test('every other non-image upload stays refused', { skip }, async (t) => {
  const { socketPath, alice, upload, state } = await setup(t);
  for (const [name, type, content] of [
    [NAME, 'text/plain', Buffer.from(REPORT)],
    ['report.pdf', 'application/pdf', Buffer.from('%PDF-1.4\n%%EOF')],
    ['page.html', 'text/html', Buffer.from('<script>alert(1)</script>')]
  ] as const) {
    const reserved = await request(
      socketPath,
      {
        method: 'POST',
        pathname: '/api/media/attachments',
        cookie: alice.cookie,
        body: { context: 'dm', clientRequestId: randomUUID(), bytes: content.length }
      },
      AttachmentAnswer
    );
    assert.equal(reserved.status, 201);
    assert.equal(reserved.body.attachment.kind, 'image');
    const { id } = reserved.body.attachment;
    const refused = await upload(alice, id, name, type, content);
    assert.deepEqual([refused.status, refused.body.code], [400, 'media_invalid_image'], name);
    assert.equal(await state(id), 'failed');
  }
});

test('deleting the VoiceRoom conversation revokes the diagnostics file', { skip }, async (t) => {
  const { socketPath, storageDir, pool, alice, ready, send, state, signInStaff } = await setup(t);
  const file = await ready(alice);
  assert.equal((await send(alice, OFFICIAL_ACCOUNT_ID, [file.id])).status, 201);
  const staff = await signInStaff();
  const staffUrl = `/api/admin/support/attachments/${file.id}/file`;
  assert.equal((await download(socketPath, staffUrl, staff)).status, 200);
  const usage = () => createAttachmentRepository({ pool }).quotaUsage(alice.id);
  const held = (await usage()).usedBytes;

  const removed = await request(socketPath, {
    method: 'DELETE',
    pathname: `/api/dm/${OFFICIAL_ACCOUNT_ID}`,
    cookie: alice.cookie
  });
  assert.equal(removed.status, 204);
  assert.equal(await state(file.id), 'deleted');
  const bound = await pool.query<{ direct_message_id: string | null }>(
    'SELECT direct_message_id FROM message_attachments WHERE id = $1',
    [file.id]
  );
  assert.equal(bound.rows[0]?.direct_message_id, null);
  assert.equal((await usage()).usedBytes, held - Buffer.byteLength(REPORT));
  assert.equal((await download(socketPath, `/api/media/attachments/${file.id}/file`, alice.cookie)).status, 404);
  assert.equal((await download(socketPath, staffUrl, staff)).status, 404);

  // Media maintenance then removes the stored file like any revoked attachment.
  assert.ok(fs.existsSync(path.join(storageDir, file.id, 'original')));
  await pool.query(`UPDATE message_attachments SET updated_at = now() - interval '2 hours' WHERE id = $1`, [file.id]);
  const attachments = createAttachmentRepository({ pool });
  const maintenance = createMediaMaintenanceService({
    attachmentRepository: attachments,
    jobRepository: createMediaJobRepository({ pool }),
    storage: createMediaStorage({ rootDir: storageDir })
  });
  assert.equal((await maintenance.cleanupOnce()).removed, 1);
  assert.equal(fs.existsSync(path.join(storageDir, file.id, 'original')), false);
  assert.deepEqual((await attachments.findById(file.id))?.storageKeys, {
    original: null,
    processed: null,
    preview: null
  });
});

test(
  'the diagnostics transition joins the caller transaction and interrupted uploads leave no file',
  { skip },
  async (t) => {
    const { pool, alice, reserve, upload, state, storageDir } = await setup(t);
    const db = kyselyOn(pool);
    const content = Buffer.from(REPORT);
    const draft = await reserve(alice, content.length);
    const repo = createAttachmentRepository({ pool });
    const original = {
      bytes: content.length,
      originalStorageKey: `${draft.id}/original`,
      originalName: NAME
    };
    await assert.rejects(
      withTransaction(db, async (tx) => {
        await tx.updateTable('users').set({ display_name: 'Temporary' }).where('id', '=', alice.id).execute();
        const accepted = await repo.markFileReady(draft.id, original, tx);
        assert.equal(accepted?.internalState, 'ready');
        assert.equal(await repo.markFileReady(draft.id, { ...original, bytes: content.length + 1 }, tx), null);
        const row = await tx
          .selectFrom('message_attachments')
          .select(['state', 'original_bytes'])
          .where('id', '=', draft.id)
          .executeTakeFirstOrThrow();
        assert.equal(row.state, 'ready');
        assert.equal(Number(row.original_bytes), content.length);
        throw new Error('Caller rolled back');
      }),
      { message: 'Caller rolled back' }
    );
    assert.equal(await state(draft.id), 'uploading');
    const owner = await db.selectFrom('users').select('display_name').where('id', '=', alice.id).executeTakeFirst();
    assert.equal(owner?.display_name, 'alice');

    await sql`
    CREATE FUNCTION interrupt_diagnostics() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.state = 'ready' THEN
          RAISE EXCEPTION 'Simulated failure during the second update';
        END IF;
        IF NEW.state = 'failed' AND OLD.state <> 'uploading' THEN
          RAISE EXCEPTION 'The first update must have rolled back before cleanup';
        END IF;
        RETURN NEW;
      END;
    $$;
  `.execute(db);
    await sql`
    CREATE TRIGGER interrupt_diagnostics BEFORE UPDATE ON message_attachments
      FOR EACH ROW EXECUTE FUNCTION interrupt_diagnostics();
  `.execute(db);
    assert.equal((await upload(alice, draft.id, NAME, 'text/plain', content)).status, 500);
    const failed = await repo.findById(draft.id);
    assert.equal(failed?.internalState, 'failed');
    assert.equal(failed?.originalBytes, null);
    assert.equal(failed?.storageKeys.original, null);
    assert.equal(fs.existsSync(path.join(storageDir, draft.id, 'original')), false);
  }
);
