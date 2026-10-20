// The admin panel's call history marks a stay's room deleted only when the
// room is gone: an unnamed temporary room still open keeps an empty name,
// a deleted room loses its name even while its row is kept.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { Value } from 'typebox/value';
import { RoomHistory } from '@voice-room/shared/contracts/admin';
import { hashPassword } from '../src/lib/password.ts';
import { cookieFrom, request, startApiServer } from './fakes/server-process.ts';

const skip = !process.env.TEST_DATABASE_URL;
const ADMIN_ID = '00000000-0000-4000-8000-0000000000ad';

test('an unnamed open room keeps its stays; a deleted room is marked gone', { skip }, async (t) => {
  const { socketPath, databaseUrl, beforeCleanup } = await startApiServer(t, {
    prefix: 'voice-room-admin-history-names-',
    env: { AUTH_RATE_LIMIT: '0', PLATFORM_ADMIN_USER_IDS: ADMIN_ID }
  });
  const pool = new Pool({ connectionString: databaseUrl });
  beforeCleanup(() => pool.end());

  await pool.query(`INSERT INTO users (id, login, display_name, password_hash) VALUES ($1, 'root', 'Root', $2)`, [
    ADMIN_ID,
    await hashPassword('password123')
  ]);
  const signedIn = await request(socketPath, {
    method: 'POST',
    pathname: '/api/auth/login',
    body: { login: 'root', password: 'password123' }
  });
  const admin = cookieFrom(signedIn.setCookie);

  await pool.query(
    `INSERT INTO rooms (id, creator_ip, is_static, name, deleted_at)
     VALUES ('unnamed-tmp', '', false, '', NULL), ('closed-room', '', true, 'Закрытая', now())`
  );
  await pool.query(
    `INSERT INTO voice_sessions (room_id, user_id, joined_at, left_at)
     VALUES ('unnamed-tmp', NULL, now() - interval '3 hours', now() - interval '2 hours'),
            ('closed-room', NULL, now() - interval '3 hours', now() - interval '2 hours')`
  );

  async function roomNamesOf(roomId: string): Promise<Array<string | null>> {
    const { body } = await request(socketPath, {
      pathname: `/api/admin/rooms/history?roomId=${roomId}`,
      cookie: admin
    });
    if (!Value.Check(RoomHistory, body)) throw new Error(`no room history for ${roomId}`);
    return body.stays.map((stay) => stay.roomName);
  }

  assert.deepEqual(await roomNamesOf('unnamed-tmp'), ['']);
  assert.deepEqual(await roomNamesOf('closed-room'), [null]);
});
