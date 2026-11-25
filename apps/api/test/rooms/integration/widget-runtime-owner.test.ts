import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { runWidgetRecovery } from '../../../src/scripts/widget-recovery.ts';
import {
  createWidgetRuntimeOwner,
  type WidgetOwnerRole,
  type WidgetRuntimeOwner
} from '../../../src/domains/rooms/widget-runtime-owner.repository.ts';
import { createTestDatabase } from '../../db-harness.ts';

async function fixture(t: TestContext) {
  const database = await createTestDatabase(t);
  const owners: WidgetRuntimeOwner[] = [];
  t.after(async () => {
    try {
      for (const owner of owners.reverse()) await owner.stop();
    } finally {
      await database.cleanup();
    }
  });
  function owner(role: WidgetOwnerRole, quiesce = async () => true, lost: () => void = () => undefined) {
    const next = createWidgetRuntimeOwner({ pool: database.pool, role, quiesce, lost });
    owners.push(next);
    return next;
  }
  async function enable() {
    await database.pool.query(
      'UPDATE widget_boundary_activation SET widget_boundary_required=true,widget_admission_enabled=true WHERE singleton'
    );
  }
  async function acknowledgment(role: WidgetOwnerRole) {
    const result = await database.pool.query<{ generation: string | null }>(
      'SELECT acknowledged_generation::text AS generation FROM widget_runtime_owners WHERE role=$1',
      [role]
    );
    assert.ok(result.rows[0]);
    return result.rows[0].generation;
  }
  return { ...database, owner, enable, acknowledgment };
}

test('only one owner per role may authorize widgets while API and gate remain independent', async (t) => {
  const f = await fixture(t);
  await f.enable();
  const api = f.owner('api');
  const otherApi = f.owner('api');
  const gate = f.owner('gate');
  assert.equal(await api.start(), true);
  assert.equal(await otherApi.start(), false);
  assert.equal(await gate.start(), true);
  assert.equal(await api.capture(), '0');
  assert.equal(await gate.allows('0'), true);
  assert.equal(await otherApi.capture(), null);
  assert.equal(await otherApi.allows('0'), false);
});

test('a recovery generation is acknowledged only after authoritative quiescence finishes', async (t) => {
  const f = await fixture(t);
  await f.enable();
  const reached = Promise.withResolvers<void>();
  const release = Promise.withResolvers<boolean>();
  let pending = true;
  const api = f.owner('api', async () => {
    if (!pending) return true;
    reached.resolve();
    return release.promise;
  });
  assert.equal(await api.start(), true);
  const generation = await api.capture();
  assert.equal(generation, '0');
  await f.pool.query(
    'UPDATE widget_boundary_activation SET widget_admission_enabled=false,recovery_generation=recovery_generation+1 WHERE singleton'
  );
  const ticking = api.tick();
  try {
    await reached.promise;
    assert.equal(await f.acknowledgment('api'), null);
    assert.equal(await api.capture(), null);
    assert.equal(await api.allows('0'), false);
  } finally {
    pending = false;
    release.resolve(true);
    await ticking;
  }
  assert.equal(await f.acknowledgment('api'), '1');
});

test('a generation changed during quiescence cannot receive a stale acknowledgment', async (t) => {
  const f = await fixture(t);
  await f.enable();
  const reached = Promise.withResolvers<void>();
  const release = Promise.withResolvers<boolean>();
  let pending = true;
  const api = f.owner('api', async () => {
    if (!pending) return true;
    reached.resolve();
    return release.promise;
  });
  await api.start();
  await f.pool.query('UPDATE widget_boundary_activation SET widget_admission_enabled=false,recovery_generation=1');
  const ticking = api.tick();
  try {
    await reached.promise;
    await f.pool.query('UPDATE widget_boundary_activation SET recovery_generation=2');
  } finally {
    pending = false;
    release.resolve(true);
    await ticking;
  }
  assert.equal(await f.acknowledgment('api'), null);
  await api.tick();
  assert.equal(await f.acknowledgment('api'), '2');
});

test('failed quiescence cannot acknowledge recovery and clean stop permits a fresh owner', async (t) => {
  const f = await fixture(t);
  let clean = false;
  const api = f.owner('api', async () => clean);
  await api.start();
  assert.equal(await f.acknowledgment('api'), null);
  clean = true;
  await api.stop();
  const replacement = f.owner('api');
  assert.equal(await replacement.start(), true);
  assert.equal(await f.acknowledgment('api'), '0');
});

test('lost owner connection fails closed without silently taking over an unquiesced predecessor', async (t) => {
  const f = await fixture(t);
  await f.enable();
  const lost = Promise.withResolvers<void>();
  const api = f.owner(
    'api',
    async () => true,
    () => lost.resolve()
  );
  await api.start();
  const row = await f.pool.query<{ pid: number }>(
    'SELECT backend_pid AS pid FROM widget_runtime_owners WHERE role=$1',
    ['api']
  );
  assert.ok(row.rows[0]);
  await f.pool.query('SELECT pg_terminate_backend($1)', [row.rows[0].pid]);
  await lost.promise;
  assert.equal(api.valid(), false);
  assert.equal(await api.capture(), null);
  assert.equal(await api.allows('0'), false);
  await f.pool.query('UPDATE widget_boundary_activation SET widget_admission_enabled=false,recovery_generation=1');
  await api.tick();
  assert.equal(await f.acknowledgment('api'), null);
  const replacement = f.owner('api');
  assert.equal(await replacement.start(), false);
  assert.equal(await replacement.capture(), null);
  const retained = await f.pool.query<{ owner_id: string }>(
    'SELECT owner_id FROM widget_runtime_owners WHERE role=$1',
    ['api']
  );
  assert.equal(retained.rows[0]?.owner_id, api.id);
});

test('operator recovery cannot accept stale empty occupancy and an earlier owner acknowledgment', async (t) => {
  const f = await fixture(t);
  const reached = Promise.withResolvers<void>();
  const release = Promise.withResolvers<boolean>();
  let held = false;
  const api = f.owner('api', async () => {
    if (!held) return true;
    reached.resolve();
    return release.promise;
  });
  const gate = f.owner('gate');
  await api.start();
  await gate.start();
  assert.equal(await f.acknowledgment('api'), '0');
  await f.enable();
  await f.pool.query("INSERT INTO rooms(id,kind,empty_since) VALUES ('stale-occupancy','widget',clock_timestamp())");
  held = true;
  let completed = false;
  const recovery = runWidgetRecovery({
    pool: f.pool,
    media: {
      async listRooms() {
        return [];
      },
      async deleteRoom() {}
    },
    prefix: 'voice-room-',
    command: 'recover'
  }).then((receipt) => {
    completed = true;
    return receipt;
  });
  let ticking: Promise<void> | undefined;
  try {
    const deadline = Date.now() + 3000;
    for (;;) {
      const state = await f.pool.query<{ generation: string }>(
        'SELECT recovery_generation::text AS generation FROM widget_boundary_activation WHERE singleton'
      );
      if (state.rows[0]?.generation === '1') break;
      assert.ok(Date.now() < deadline, 'operator must request the new recovery generation');
      await setImmediate();
    }
    ticking = api.tick();
    await reached.promise;
    await gate.tick();
    assert.equal(completed, false, 'stale occupancy and generation zero cannot complete recovery');
    assert.equal(await f.acknowledgment('api'), '0');
  } finally {
    held = false;
    release.resolve(true);
    await ticking;
  }
  const receipt = await recovery;
  assert.equal(receipt.recoveryGeneration, '1');
  assert.equal(receipt.widgetApiQuiescent, true);
  assert.equal(receipt.apiOwner, api.id);
  assert.equal(receipt.gateOwner, gate.id);
});
