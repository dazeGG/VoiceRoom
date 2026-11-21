import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { RoomServiceClient } from 'livekit-server-sdk';
import { createTestDatabase } from './db-harness.ts';
import { createRoomStore } from '../src/app/room-store.ts';
import { createWidgetRuntimeOwner } from '../src/domains/rooms/widget-runtime-owner.repository.ts';
import { createLiveKitAuthGateService } from '../src/domains/admission/livekit-auth-gate.service.ts';
import { runWidgetRecovery } from '../src/scripts/widget-recovery.ts';

const recoveryScript = fileURLToPath(new URL('../src/scripts/widget-recovery.ts', import.meta.url));
function missingMediaFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === 1 &&
    'stderr' in error &&
    typeof error.stderr === 'string' &&
    error.stderr.includes('"code":"media_configuration_missing"')
  );
}

async function fixture(t: TestContext) {
  const db = await createTestDatabase(t);

  await db.pool.query(
    "UPDATE widget_boundary_activation SET widget_boundary_required=true,widget_admission_enabled=true;INSERT INTO rooms(id,kind,empty_since) VALUES('recovery-widget','widget',now()),('recovery-main','main',now())"
  );
  const store = createRoomStore({ pool: db.pool });
  for (const roomId of ['recovery-widget', 'recovery-main'])
    assert.equal(
      (
        await store.createLiveKitGateCredential({
          roomId,
          peerId: 'recovery-peer',
          principal: { principalType: 'guest', principalId: 'recovery-guest' },
          credentialHash: crypto.randomBytes(32).toString('hex'),
          expiresAt: Date.now() + 600000
        })
      ).status,
      'created'
    );
  const api = createWidgetRuntimeOwner({ pool: db.pool, role: 'api', quiesce: async () => true, lost: () => {} });
  const gate = createWidgetRuntimeOwner({ pool: db.pool, role: 'gate', quiesce: async () => true, lost: () => {} });
  await api.start();
  await gate.start();
  const timer = setInterval(() => void Promise.all([api.tick(), gate.tick()]), 50);
  t.after(async () => {
    clearInterval(timer);
    await gate.stop();
    await api.stop();
    await db.cleanup();
  });
  return db;
}

test(
  'failed SFU termination leaves admission disabled and widget credentials revoked without false success',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { pool } = await fixture(t);
    const media = {
      async listRooms() {
        return [
          { name: 'proof-recovery-widget', numParticipants: 2 },
          { name: 'proof-recovery-main', numParticipants: 1 }
        ];
      },
      async deleteRoom() {
        throw new Error('SFU unavailable');
      }
    };
    await assert.rejects(runWidgetRecovery({ pool, media, prefix: 'proof-', command: 'recover' }), /SFU unavailable/);
    await assert.rejects(
      runWidgetRecovery({ pool, media, prefix: 'proof-', command: 'verify-disabled' }),
      /not_terminated/
    );
    const state = await pool.query<{ widget_boundary_required: boolean; widget_admission_enabled: boolean }>(
      'SELECT * FROM widget_boundary_activation'
    );
    assert.equal(state.rows[0]?.widget_boundary_required, true);
    assert.equal(state.rows[0]?.widget_admission_enabled, false);
    const creds = await pool.query<{ room_id: string; revoked: boolean }>(
      'SELECT room_id,revoked_at IS NOT NULL AS revoked FROM livekit_gate_credentials ORDER BY room_id'
    );
    assert.deepEqual(creds.rows, [
      { room_id: 'recovery-main', revoked: false },
      { room_id: 'recovery-widget', revoked: true }
    ]);
  }
);

test(
  'operator CLI recovery and readonly verification work against disposable PostgreSQL and actual LiveKit',
  { skip: !process.env.WIDGET_RECOVERY_TEST_LIVEKIT_URL },
  async (t) => {
    const db = await fixture(t);
    const prefix = `recovery-${crypto.randomUUID()}-`;
    const url = process.env.WIDGET_RECOVERY_TEST_LIVEKIT_URL ?? '';
    const key = process.env.WIDGET_RECOVERY_TEST_LIVEKIT_KEY ?? '';
    const secret = process.env.WIDGET_RECOVERY_TEST_LIVEKIT_SECRET ?? '';
    const media = new RoomServiceClient(url, key, secret);
    const widgetName = prefix + 'recovery-widget',
      mainName = prefix + 'recovery-main';
    await media.createRoom({ name: widgetName, emptyTimeout: 300 });
    await media.createRoom({ name: mainName, emptyTimeout: 300 });
    t.after(async () => {
      for (const name of [widgetName, mainName])
        try {
          await media.deleteRoom(name);
        } catch {
          /* already removed */
        }
    });
    const run = promisify(execFile);
    const env = {
      ...process.env,
      DATABASE_URL: db.databaseUrl,
      LIVEKIT_INTERNAL_URL: url,
      LIVEKIT_API_KEY: key,
      LIVEKIT_API_SECRET: secret,
      LIVEKIT_ROOM_PREFIX: prefix
    };
    for (const command of ['recover', 'verify-disabled']) {
      const result = await run(process.execPath, [recoveryScript, command], { env });
      assert.match(result.stdout, /"ok":true/);
      assert.match(result.stdout, /"widgetMediaEmpty":true/);
    }
    assert.equal((await media.listRooms([widgetName])).length, 0);
    assert.equal((await media.listRooms([mainName])).length, 1);
    const creds = await db.pool.query<{ room_id: string; revoked: boolean }>(
      'SELECT room_id,revoked_at IS NOT NULL AS revoked FROM livekit_gate_credentials ORDER BY room_id'
    );
    assert.deepEqual(creds.rows, [
      { room_id: 'recovery-main', revoked: false },
      { room_id: 'recovery-widget', revoked: true }
    ]);
    await assert.rejects(
      run(process.execPath, [recoveryScript, 'verify-disabled'], {
        env: { ...env, LIVEKIT_API_SECRET: 'invalid' }
      })
    );
    await db.pool.query('UPDATE widget_boundary_activation SET widget_admission_enabled=true');
    await assert.rejects(
      run(process.execPath, [recoveryScript, 'recover'], {
        env: { ...env, LIVEKIT_API_SECRET: '' }
      })
    );
    const disabled = await db.pool.query<{ enabled: boolean }>(
      'SELECT widget_admission_enabled AS enabled FROM widget_boundary_activation'
    );
    assert.equal(disabled.rows[0]?.enabled, false);
  }
);

test(
  'recovery waits for the original API process to release widget seats while main calls remain',
  { skip: !process.env.WIDGET_RECOVERY_TEST_LIVEKIT_URL },
  async (t) => {
    const { startApiServer, request } = await import('./fakes/server-process.ts');
    const { openWs, joinVoiceRoom } = await import('./ws-harness.ts');
    const { WidgetRoomCreated } = await import('@voiceroom/shared/contracts/widget');
    const { RoomCreated } = await import('@voiceroom/shared/contracts/rooms');
    const prefix = `recovery-api-${crypto.randomUUID()}-`;
    const url = process.env.WIDGET_RECOVERY_TEST_LIVEKIT_URL ?? '';
    const key = process.env.WIDGET_RECOVERY_TEST_LIVEKIT_KEY ?? '';
    const secret = process.env.WIDGET_RECOVERY_TEST_LIVEKIT_SECRET ?? '';
    const server = await startApiServer(t, {
      env: {
        WIDGET_ENABLED: 'true',
        LIVEKIT_INTERNAL_URL: url,
        LIVEKIT_API_KEY: key,
        LIVEKIT_API_SECRET: secret,
        LIVEKIT_ROOM_PREFIX: prefix,
        ROOM_CREATE_RATE_LIMIT: '0'
      }
    });
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: server.databaseUrl });
    const gate = createLiveKitAuthGateService({
      pool,
      secret: 'recovery-test-secret-01234567890123456789',
      upstreamUrl: url.replace(/^http/, 'ws'),
      roomPrefix: prefix
    });
    await gate.start();
    server.beforeCleanup(async () => {
      await gate.stop();
      await pool.end();
    });
    await pool.query(
      'UPDATE widget_boundary_activation SET widget_boundary_required=true,widget_admission_enabled=true'
    );
    const widget = (
      await request(
        server.socketPath,
        { method: 'POST', pathname: '/api/widget/rooms', body: { chat: false } },
        WidgetRoomCreated
      )
    ).body;
    const main = (await request(server.socketPath, { method: 'POST', pathname: '/api/rooms', body: {} }, RoomCreated))
      .body;
    const ws = openWs(server.socketPath, { path: '/api/widget/ws' }),
      normal = openWs(server.socketPath);
    t.after(() => {
      ws.ws.close();
      normal.ws.close();
    });
    await ws.ready;
    await normal.ready;
    await joinVoiceRoom(ws, {
      roomId: widget.roomId,
      peerId: 'recovery-widget-peer',
      sessionToken: 's'.repeat(32),
      name: 'Widget'
    });
    await joinVoiceRoom(normal, {
      roomId: main.roomId,
      peerId: 'recovery-main-peer',
      sessionToken: 'm'.repeat(32),
      name: 'Main'
    });
    const media = new RoomServiceClient(url, key, secret);
    await media.createRoom({ name: prefix + widget.roomId });
    await media.createRoom({ name: prefix + main.roomId });
    t.after(async () => {
      for (const id of [widget.roomId, main.roomId])
        try {
          await media.deleteRoom(prefix + id);
        } catch {
          /* already removed */
        }
    });
    // Inject a failed mark-active persistence result: storage says empty while the real WS seat remains live.
    await pool.query("UPDATE rooms SET empty_since=now() WHERE id=$1 AND kind='widget'", [widget.roomId]);
    const run = promisify(execFile);
    const result = await run(process.execPath, [recoveryScript, 'recover'], {
      env: {
        ...process.env,
        DATABASE_URL: server.databaseUrl,
        LIVEKIT_INTERNAL_URL: url,
        LIVEKIT_API_KEY: key,
        LIVEKIT_API_SECRET: secret,
        LIVEKIT_ROOM_PREFIX: prefix
      }
    });
    assert.match(result.stdout, /"widgetOccupancyEmpty":true/);
    assert.match(result.stdout, /"widgetApiQuiescent":true/);
    assert.match(result.stdout, /"widgetGateQuiescent":true/);
    assert.match(result.stdout, /"recoveryGeneration":"1"/);
    assert.equal(ws.ws.readyState, 3);
    assert.equal(normal.ws.readyState, 1);
    const rows = await pool.query<{ id: string; empty: boolean }>(
      'SELECT id,empty_since IS NOT NULL AS empty FROM rooms ORDER BY id'
    );
    assert.equal(rows.rows.find((r) => r.id === widget.roomId)?.empty, true);
    assert.equal(rows.rows.find((r) => r.id === main.roomId)?.empty, false);
    assert.equal((await media.listRooms([prefix + widget.roomId])).length, 0);
    assert.equal((await media.listRooms([prefix + main.roomId])).length, 1);
  }
);

test(
  'missing media configuration creates a new recovery generation; old ACKs cannot prove standalone verification',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const db = await createTestDatabase(t);
    const api = createWidgetRuntimeOwner({ pool: db.pool, role: 'api', quiesce: async () => true, lost: () => {} });
    const gate = createWidgetRuntimeOwner({ pool: db.pool, role: 'gate', quiesce: async () => true, lost: () => {} });
    t.after(async () => {
      await api.stop();
      await gate.stop();
      await db.cleanup();
    });
    await api.start();
    await gate.start();
    await db.pool.query(
      'UPDATE widget_boundary_activation SET widget_boundary_required=true,widget_admission_enabled=true'
    );
    const run = promisify(execFile);
    await assert.rejects(
      run(process.execPath, [recoveryScript, 'recover'], {
        env: {
          ...process.env,
          DATABASE_URL: db.databaseUrl,
          LIVEKIT_INTERNAL_URL: '',
          LIVEKIT_URL: '',
          LIVEKIT_API_KEY: '',
          LIVEKIT_API_SECRET: ''
        }
      }),
      missingMediaFailure
    );
    const rows = await db.pool.query<{ enabled: boolean; generation: string }>(
      'SELECT widget_admission_enabled AS enabled,recovery_generation::text AS generation FROM widget_boundary_activation'
    );
    assert.deepEqual(rows.rows, [{ enabled: false, generation: '1' }]);
    const media = {
      async listRooms() {
        return [];
      },
      async deleteRoom() {}
    };
    const verify = () => runWidgetRecovery({ pool: db.pool, media, prefix: 'voice-room-', command: 'verify-disabled' });
    await assert.rejects(verify(), /quiescence_unproven/, 'preactivation ACK0 must not prove the new generation');
    await api.tick();
    await assert.rejects(verify(), /quiescence_unproven/, 'one new ACK is insufficient');
    await gate.tick();
    const result = await verify();
    assert.equal(result.recoveryGeneration, '1');
    assert.equal(result.apiOwner, api.id);
    assert.equal(result.gateOwner, gate.id);
  }
);

test(
  'missing-media recovery waits for the same global fence before disabling and changing generation',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const db = await createTestDatabase(t);
    const lock = await db.pool.connect();
    t.after(async () => {
      try {
        await lock.query('ROLLBACK');
      } finally {
        lock.release();
        await db.cleanup();
      }
    });
    await db.pool.query(
      'UPDATE widget_boundary_activation SET widget_boundary_required=true,widget_admission_enabled=true'
    );
    await lock.query('BEGIN');
    await lock.query("SELECT pg_advisory_xact_lock(hashtext('voice-room:widget-recovery'))");
    let finished = false;
    const child = promisify(execFile)(process.execPath, [recoveryScript, 'recover'], {
      env: {
        ...process.env,
        DATABASE_URL: db.databaseUrl,
        LIVEKIT_INTERNAL_URL: '',
        LIVEKIT_URL: '',
        LIVEKIT_API_KEY: '',
        LIVEKIT_API_SECRET: ''
      }
    }).then(
      () => {
        finished = true;
        throw new Error('missing-media command unexpectedly succeeded');
      },
      (error: unknown) => {
        finished = true;
        return error;
      }
    );
    const deadline = Date.now() + 4000;
    let waiting = false;
    while (Date.now() < deadline) {
      const observed = await db.pool.query<{ waiting: boolean }>(
        "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%' AND pid<>pg_backend_pid()) AS waiting"
      );
      if (observed.rows[0]?.waiting) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(waiting, true, 'the actual CLI must reach the held advisory fence');
    assert.equal(finished, false);
    const before = await db.pool.query<{ enabled: boolean; generation: string }>(
      'SELECT widget_admission_enabled AS enabled,recovery_generation::text AS generation FROM widget_boundary_activation'
    );
    assert.deepEqual(before.rows, [{ enabled: true, generation: '0' }]);
    await lock.query('COMMIT');
    const failed = await child;
    assert.equal(missingMediaFailure(failed), true);
    const after = await db.pool.query<{ enabled: boolean; generation: string }>(
      'SELECT widget_admission_enabled AS enabled,recovery_generation::text AS generation FROM widget_boundary_activation'
    );
    assert.deepEqual(after.rows, [{ enabled: false, generation: '1' }]);
  }
);
