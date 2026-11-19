// The admin widgets section over a migrated database: the state is read from
// the widget boundary tables, the limits from the configuration, and today's
// numbers count only the calls in widget rooms. Over HTTP it is staff-only and
// has no way to switch admission.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { SignedIn } from '@voice-room/shared/contracts/account';
import { AdminWidgets } from '@voice-room/shared/contracts/admin';
import { Failure } from '@voice-room/shared/contracts/http';
import type { StaffPermission } from '@voice-room/shared/contracts/staff';
import { createAdminRoomsRepository } from '../src/domains/admin/admin-rooms.repository.ts';
import { createAdminStatsRepository } from '../src/domains/admin/admin-stats.repository.ts';
import { createAdminWidgetsService } from '../src/domains/admin/admin-widgets.service.ts';
import { hashPassword } from '../src/lib/password.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';
import { cookieFrom, registerAccount, request, startApiServer } from './fakes/server-process.ts';
import { staffCookie } from './staff-session.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;
const ADMIN_ID = '00000000-0000-4000-8000-0000000000ad';
const LIMITS = { maxRoomPeers: 12, createRateLimit: 20, createRateWindowMs: 60_000, powDifficulty: 14 };

type Queryable = Pick<Pool, 'query'>;

/** A stay `from`–`to` minutes after today's Moscow midnight, so the day never splits it. */
async function stayToday(
  pool: Queryable,
  roomId: string,
  from: number,
  to: number,
  who: { kind: 'main' | 'widget' | null; clientId?: string; userId?: string; ipKey?: string }
): Promise<void> {
  await pool.query(
    `INSERT INTO voice_sessions (room_id, room_kind, user_id, client_id, ip_key, joined_at, left_at)
     SELECT $1, $2, $3, $4, $5, midnight + make_interval(mins => $6), midnight + make_interval(mins => $7)
     FROM (SELECT date_trunc('day', now() AT TIME ZONE 'Europe/Moscow') AT TIME ZONE 'Europe/Moscow' AS midnight) d`,
    [roomId, who.kind, who.userId ?? null, who.clientId ?? null, who.ipKey ?? null, from, to]
  );
}

const guest = (n: number) => `a${String(n).padStart(7, '0')}-1111-4111-8111-111111111111`;

function serviceOver(pool: Pool, liveCalls: { roomId: string; since: number }[] = []) {
  const permissions: Record<string, readonly StaffPermission[]> = { moderator: ['rooms.view'], nobody: [] };
  return createAdminWidgetsService({
    staff: { can: (userId, permission) => Promise.resolve(permissions[userId]?.includes(permission) ?? false) },
    rooms: () => createAdminRoomsRepository({ pool }),
    stats: () => createAdminStatsRepository({ pool }),
    liveCalls: () => liveCalls,
    flagEnabled: true,
    limits: LIMITS
  });
}

test('the widgets section reads the boundary, the limits and only the widget calls of today', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  await pool.query(
    `UPDATE widget_boundary_activation
       SET widget_boundary_required = true, widget_admission_enabled = true, recovery_generation = 3`
  );
  await pool.query(
    `UPDATE widget_runtime_owners SET owner_id = gen_random_uuid(), backend_pid = 1, acknowledged_generation = 3
     WHERE role = 'api'`
  );

  // Two widget calls: one of two guests from one address, then one guest twice.
  await stayToday(pool, 'P8NZ4T', 10, 30, { kind: 'widget', clientId: guest(1), ipKey: 'aaaaaaaaaaaaaaaa' });
  await stayToday(pool, 'P8NZ4T', 20, 40, { kind: 'widget', clientId: guest(2), ipKey: 'aaaaaaaaaaaaaaaa' });
  await stayToday(pool, 'H3K9QP', 50, 60, { kind: 'widget', clientId: guest(3), ipKey: 'bbbbbbbbbbbbbbbb' });
  await stayToday(pool, 'H3K9QP', 55, 70, { kind: 'widget', clientId: guest(3), ipKey: 'bbbbbbbbbbbbbbbb' });
  // Neither the app's own rooms nor stays recorded before the kind was kept count.
  await stayToday(pool, 'kitchen', 10, 100, { kind: 'main', clientId: guest(4), ipKey: 'cccccccccccccccc' });
  await stayToday(pool, 'attic', 10, 100, { kind: null, clientId: guest(5), ipKey: 'dddddddddddddddd' });

  const answer = await serviceOver(pool).widgets('moderator');
  assert.deepEqual(answer, {
    state: {
      admissionEnabled: true,
      boundaryRequired: true,
      recoveryGeneration: 3,
      owners: [
        { role: 'api', claimed: true, acknowledgedGeneration: 3 },
        { role: 'gate', claimed: false, acknowledgedGeneration: null }
      ],
      flagEnabled: true
    },
    limits: LIMITS,
    today: { calls: 2, guests: 3, distinctIpKeys: 2, voiceMinutes: 20 + 20 + 10 + 15 }
  });

  // A call someone is still in is not finished yet.
  const live = await serviceOver(pool, [{ roomId: 'H3K9QP', since: Date.now() + 2 * 86_400_000 }]).widgets('moderator');
  assert.equal(live?.today.calls, 2, 'a live call that began after the finished one leaves it alone');

  const overview = await createAdminStatsRepository({ pool }).overview();
  assert.equal(overview.widgetCallsToday, 2);
  assert.equal(overview.widgetGuestsToday, 3);
  assert.equal(overview.callsToday, 4);

  assert.equal(await serviceOver(pool).widgets('nobody'), null, 'without rooms.view the section is closed');
});

test(
  'over HTTP the widgets section is staff-only, read only and carries the configured limits',
  { skip },
  async (t) => {
    const { socketPath, databaseUrl, beforeCleanup } = await startApiServer(t, {
      prefix: 'voice-room-admin-widgets-',
      env: {
        AUTH_RATE_LIMIT: '0',
        PLATFORM_ADMIN_USER_IDS: ADMIN_ID,
        MAX_ROOM_PEERS: '7',
        ROOM_CREATE_RATE_LIMIT: '5',
        ROOM_CREATE_RATE_WINDOW_MS: '30000',
        ROOM_CREATE_POW_DIFFICULTY: '3'
      }
    });
    const pool = new Pool({ connectionString: databaseUrl });
    beforeCleanup(() => pool.end());
    await pool.query(`INSERT INTO users (id, login, display_name, password_hash) VALUES ($1, 'root', 'Root', $2)`, [
      ADMIN_ID,
      await hashPassword('password123')
    ]);
    const signedIn = await request(
      socketPath,
      { method: 'POST', pathname: '/api/auth/login', body: { login: 'root', password: 'password123' } },
      SignedIn
    );
    const admin = await staffCookie(socketPath, cookieFrom(signedIn.setCookie));
    const alice = await registerAccount(socketPath, 'alice');

    const pathname = '/api/admin/widgets';
    assert.equal((await request(socketPath, { pathname })).status, 401);
    const denied = await request(socketPath, { pathname, cookie: alice }, Failure);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'platform_admin_required');

    const page = await request(socketPath, { pathname, cookie: admin }, AdminWidgets);
    assert.equal(page.status, 200);
    assert.deepEqual(page.body.limits, {
      maxRoomPeers: 7,
      createRateLimit: 5,
      createRateWindowMs: 30_000,
      powDifficulty: 3
    });
    assert.equal(page.body.state.admissionEnabled, false);
    assert.equal(page.body.state.flagEnabled, false);

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      const write = await request(socketPath, { method, pathname, cookie: admin, body: { admissionEnabled: true } });
      assert.equal(write.status, 404, `${method} cannot switch admission`);
    }
  }
);
