// Every finished stay in a room's voice becomes one voice_sessions row: when
// a peer leaves, and for everyone still in voice when the API stops. The
// migration rolls back cleanly.

import test from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { Pool } from 'pg';

import { createApiRuntime } from '../src/app/api-runtime.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';
import { defined } from './helpers/assert-defined.ts';
import { listeningPort } from './helpers/listening-port.ts';
import { rollBackThrough } from './migration-steps.ts';
import { joinVoiceRoom, openWs, sendWs } from './ws-harness.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;

type SessionRow = { room_id: string; user_id: string | null; joined_at: Date; left_at: Date };

function listen(server: http.Server) {
  return new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(listeningPort(server)));
  });
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 5000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() - started > timeoutMs) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('a stay in voice is recorded when the peer leaves and when the API stops', { skip }, async (t) => {
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const db = new Pool({ connectionString: databaseUrl });
  const runtime = createApiRuntime();
  runtime.services.connect({ databaseUrl, logger: SILENT });
  // The reconnect lease of a dropped socket must not keep the test process alive.
  const server = runtime.createServer({
    realtimeSetTimeout: (callback, ms) => setTimeout(callback, ms).unref()
  });
  t.after(async () => {
    await runtime.closeStores();
    await db.end();
    await cleanup();
  });
  const port = await listen(server);

  const roomId = 'voice-session-room';
  await runtime.services.getRoomStore().createRoom({ roomId, creatorIp: '127.0.0.1' });
  const { user } = await runtime.services
    .getUserStore()
    .createUser({ login: 'ada', displayName: 'Ада', password: 'lovelace-1843' });
  assert.ok(user);
  const { token } = await runtime.services.getUserStore().createSession({ userId: user.id, now: Date.now() });

  const ada = openWs(port, { cookie: `vr_session=${encodeURIComponent(token)}` });
  const guest = openWs(port);
  await Promise.all([ada.ready, guest.ready]);
  const adaSeat = { roomId, peerId: 'ada-peer', sessionToken: 'a'.repeat(32) };
  const guestSeat = { roomId, peerId: 'guest-peer', sessionToken: 'g'.repeat(32) };
  const beforeJoin = Date.now();
  await joinVoiceRoom(ada, { ...adaSeat, name: 'Ада' });
  await joinVoiceRoom(guest, { ...guestSeat, name: 'Гость' });

  const rows = () =>
    db
      .query<SessionRow>('SELECT room_id, user_id, joined_at, left_at FROM voice_sessions ORDER BY left_at')
      .then((result) => result.rows);
  assert.deepEqual(await rows(), [], 'nothing is written while the stay goes on');

  sendWs(guest.ws, 'room.leave', guestSeat);
  const afterGuestLeft = await waitFor(rows, (found) => found.length === 1);
  assert.equal(afterGuestLeft.length, 1);
  const guestRow = defined(afterGuestLeft[0], 'the guest voice session row');
  assert.equal(guestRow.room_id, roomId);
  assert.equal(guestRow.user_id, null, 'a guest has no account');
  assert.ok(guestRow.joined_at.getTime() >= beforeJoin - 1000);
  assert.ok(guestRow.left_at.getTime() >= guestRow.joined_at.getTime());

  // Ada is still in voice when the process stops: as on SIGTERM, the sockets
  // and the server close first (her seat waits out its reconnect lease), then
  // the stores, and her stay ends there.
  await Promise.all(
    [ada.ws, guest.ws].map((ws) => {
      const closed = new Promise((resolve) => ws.once('close', resolve));
      ws.close();
      return closed;
    })
  );
  // The app, not just its http.Server: the delivery listener gives its pool client back.
  await server.app.close();
  const beforeStop = Date.now();
  await runtime.closeStores();
  const afterStop = await rows();
  assert.equal(afterStop.length, 2);
  const adaRow = defined(afterStop[1], "Ada's voice session row");
  assert.equal(adaRow.user_id, user.id);
  assert.equal(adaRow.room_id, roomId);
  assert.ok(adaRow.left_at.getTime() >= beforeStop - 1000);
});

test('voice_sessions keeps a stay in order and rolls back cleanly', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  const exists = async () => {
    const { rows } = await pool.query<{ name: string | null }>(`SELECT to_regclass('public.voice_sessions') AS name`);
    return rows[0]?.name != null;
  };

  await runMigrations({ databaseUrl, logger: SILENT });
  assert.equal(await exists(), true);
  await pool.query(
    `INSERT INTO voice_sessions (room_id, joined_at, left_at) VALUES ('r1', now() - interval '1 hour', now())`
  );
  await assert.rejects(
    pool.query(
      `INSERT INTO voice_sessions (room_id, joined_at, left_at) VALUES ('r1', now(), now() - interval '1 hour')`
    ),
    /voice_sessions_order_check/
  );

  await rollBackThrough(databaseUrl, '20261015120000_create_voice_sessions');
  assert.equal(await exists(), false);

  await runMigrations({ databaseUrl, logger: SILENT });
  assert.equal(await exists(), true);
});
