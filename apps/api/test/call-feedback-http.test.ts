// "How was the call?": an account or a guest answers after a call, within a
// rate limit, and only a platform administrator reads the answers.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import type { Me, SignedIn } from '@voice-room/shared/contracts/account';
import type { AdminCallFeedbackPage, CallFeedbackBody } from '@voice-room/shared/contracts/feedback';
import type { Failure } from '@voice-room/shared/contracts/http';
import { hashPassword } from '../src/lib/password.ts';
import { cookieFrom, registerAccount, request, startApiServer } from './fakes/server-process.ts';
import { staffCookie } from './staff-session.ts';

const ADMIN_ID = '00000000-0000-4000-8000-0000000000ad';
const DAY = 24 * 60 * 60 * 1000;

const call: CallFeedbackBody['call'] = {
  roomId: 'kitchen',
  durationS: 1260,
  peers: 3,
  platform: 'desktop_app',
  quality: {
    rttAvgMs: 48.5,
    inboundLossAvgPct: 0.4,
    outboundLossAvgPct: 0,
    jitterAvgMs: 9,
    reconnects: 0,
    transport: 'udp'
  }
};

test('accounts and guests answer, and only the administrator reads the answers', async (t) => {
  const { socketPath, databaseUrl, beforeCleanup } = await startApiServer(t, {
    prefix: 'voice-room-feedback-',
    env: { AUTH_RATE_LIMIT: '0', PLATFORM_ADMIN_USER_IDS: ADMIN_ID, CALL_FEEDBACK_RATE_LIMIT: '3' }
  });
  const pool = new Pool({ connectionString: databaseUrl });
  beforeCleanup(() => pool.end());

  await pool.query(`INSERT INTO users (id, login, display_name, password_hash) VALUES ($1, 'root', 'Root', $2)`, [
    ADMIN_ID,
    await hashPassword('password123')
  ]);
  const signedIn = await request<SignedIn>(socketPath, {
    method: 'POST',
    pathname: '/api/auth/login',
    body: { login: 'root', password: 'password123' }
  });
  const admin = await staffCookie(socketPath, cookieFrom(signedIn.setCookie));
  const alice = await registerAccount(socketPath, 'alice');
  const aliceId = (await request<Me>(socketPath, { pathname: '/api/auth/me', cookie: alice })).body.user!.id;
  await pool.query(
    `INSERT INTO rooms (id, creator_ip, is_static, owner_id, name) VALUES ('kitchen', '', true, $1, 'Кухня')`,
    [aliceId]
  );

  const answer = (cookie: string | undefined, body: object) =>
    request<Pick<Failure, 'code'>>(socketPath, { method: 'POST', pathname: '/api/feedback/calls', cookie, body });

  // A thumbs up keeps only the tags of a good call, each once.
  const good = await answer(alice, {
    rating: 'good',
    tags: ['sound', 'drops', 'sound', 'easy'],
    comment: '  всё супер  ',
    call
  });
  assert.equal(good.status, 201);
  // A guest answers too, without an account.
  const guest = await answer(undefined, {
    rating: 'bad',
    tags: ['echo_noise', 'delay'],
    // PostgreSQL refuses NUL in text: control characters go, line breaks stay.
    comment: 'эхо\u0000\nи шум',
    call: { ...call, roomId: 'gone-room', platform: 'mobile', quality: null }
  });
  assert.equal(guest.status, 201);

  assert.equal((await answer(alice, { rating: 'meh', tags: [], call })).status, 400);
  assert.equal((await answer(alice, { rating: 'bad', tags: ['made_up'], call })).status, 400);
  assert.equal((await answer(alice, { rating: 'bad', tags: [], call: { ...call, durationS: -1 } })).status, 400);
  assert.equal(
    (await answer(alice, { rating: 'bad', tags: [], comment: 'x'.repeat(1001), call })).status,
    400,
    'a comment over the limit is refused'
  );

  // An answer from long ago is outside the default 30 days.
  await pool.query(
    `INSERT INTO call_feedback (rating, tags, room_id, duration_s, peers, platform, created_at)
     VALUES ('bad', '{drops}', 'old-room', 60, 1, 'browser', $1)`,
    [new Date(Date.now() - 40 * DAY)]
  );

  assert.equal((await request(socketPath, { pathname: '/api/admin/feedback' })).status, 401);
  const forbidden = await request<Failure>(socketPath, { pathname: '/api/admin/feedback', cookie: alice });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.code, 'platform_admin_required');

  const read = async (query = '') => {
    const page = await request<AdminCallFeedbackPage>(socketPath, {
      pathname: `/api/admin/feedback${query}`,
      cookie: admin
    });
    assert.equal(page.status, 200);
    return page.body;
  };

  const recent = await read();
  assert.equal(recent.days, 30);
  assert.deepEqual(recent.summary, {
    good: 1,
    bad: 1,
    tags: [
      { tag: 'delay', count: 1 },
      { tag: 'easy', count: 1 },
      { tag: 'echo_noise', count: 1 },
      { tag: 'sound', count: 1 }
    ]
  });
  assert.deepEqual(
    recent.entries.map((entry) => entry.rating),
    ['bad', 'good'],
    'newest first'
  );
  const [guestEntry, aliceEntry] = recent.entries;
  assert.equal(guestEntry!.author, null);
  assert.equal(guestEntry!.roomName, null, 'a room that is gone has no name');
  assert.equal(guestEntry!.platform, 'mobile');
  assert.equal(guestEntry!.quality, null);
  assert.equal(guestEntry!.comment, 'эхо\nи шум');
  assert.deepEqual(aliceEntry!.author, { userId: aliceId, login: 'alice', displayName: 'alice' });
  assert.deepEqual(aliceEntry!.tags, ['sound', 'easy']);
  assert.equal(aliceEntry!.comment, 'всё супер');
  assert.equal(aliceEntry!.roomName, 'Кухня');
  assert.equal(aliceEntry!.durationS, 1260);
  assert.equal(aliceEntry!.peers, 3);
  assert.deepEqual(aliceEntry!.quality, call.quality);

  const year = await read('?days=365&rating=bad');
  assert.equal(year.summary.bad, 2, 'the summary counts every answer of the period');
  assert.equal(year.summary.good, 1);
  assert.deepEqual(
    year.entries.map((entry) => entry.roomId),
    ['gone-room', 'old-room'],
    'the list shows only the rating asked for'
  );
  assert.equal((await request(socketPath, { pathname: '/api/admin/feedback?days=12', cookie: admin })).status, 400);

  // Three answers per window: the account has used one, a fourth is refused.
  assert.equal((await answer(alice, { rating: 'good', tags: [], call })).status, 201);
  assert.equal((await answer(alice, { rating: 'good', tags: [], call })).status, 201);
  const limited = await answer(alice, { rating: 'good', tags: [], call });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, 'rate_limited');
});
