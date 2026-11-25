import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { createRoomStore } from '../../../src/app/room-store.ts';
import { createCredentialBoundaryService } from '../../../src/domains/admission/credential-boundary.service.ts';
import { createLiveKitAuthGateService } from '../../../src/domains/admission/livekit-auth-gate.service.ts';
import { createTestDatabase } from '../../db-harness.ts';

test('a gate started before widget migrations retries owner bootstrap when the schema is installed', async (t) => {
  const database = await createTestDatabase(t);
  const service = createLiveKitAuthGateService({ pool: database.pool, secret: 'test-gate-secret-at-least-32-bytes' });
  const server = service.createServer();
  t.after(async () => {
    await service.stop();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await database.cleanup();
  });

  // CI starts the gate before the API applies migrations. Keep the rest of the
  // migrated fixture available so only the owner bootstrap ordering is tested.
  await database.pool.query('ALTER TABLE widget_runtime_owners RENAME TO pending_widget_runtime_owners');
  await service.start().catch(() => undefined);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const readinessUrl = `http://127.0.0.1:${address.port}/readyz`;
  assert.equal((await fetch(readinessUrl)).status, 200, 'ordinary gate readiness is independent of widget ownership');

  await database.pool.query('ALTER TABLE pending_widget_runtime_owners RENAME TO widget_runtime_owners');
  const deadline = Date.now() + 2_000;
  let acknowledgment: string | null | undefined;
  while (acknowledgment !== '0' && Date.now() < deadline) {
    await setTimeout(25);
    const owner = await database.pool.query<{ acknowledged_generation: string | null }>(
      "SELECT acknowledged_generation::text FROM widget_runtime_owners WHERE role='gate' AND owner_id IS NOT NULL"
    );
    acknowledgment = owner.rows[0]?.acknowledged_generation;
  }
  assert.equal(acknowledgment, '0', 'the running gate must acquire and acknowledge its owner without a restart');
});

test('an unclean widget owner leaves main admission ready without allowing widgets or silent takeover', async (t) => {
  const database = await createTestDatabase(t);
  const secret = 'test-gate-secret-at-least-32-bytes';
  const boundary = createCredentialBoundaryService({ roomStore: createRoomStore({ pool: database.pool }), secret });
  const service = createLiveKitAuthGateService({ pool: database.pool, boundary });
  const server = service.createServer();
  t.after(async () => {
    await service.stop();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await database.cleanup();
  });
  const oldOwner = '11111111-1111-4111-8111-111111111111';
  await database.pool.query(
    "UPDATE widget_runtime_owners SET owner_id=$1,backend_pid=pg_backend_pid() WHERE role='gate'",
    [oldOwner]
  );
  await database.pool.query(
    'UPDATE widget_boundary_activation SET widget_boundary_required=true,widget_admission_enabled=true'
  );
  await database.pool.query(
    "INSERT INTO rooms(id,kind) VALUES ('bootstrap-main','main'),('bootstrap-widget','widget')"
  );
  await service.start();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  assert.equal((await fetch(`http://127.0.0.1:${address.port}/readyz`)).status, 200);
  for (const roomId of ['bootstrap-main', 'bootstrap-widget']) {
    const issued = await boundary.issueCredential({
      roomId,
      peerId: 'bootstrap-peer',
      principal: { principalType: 'guest', principalId: 'bootstrap-guest' }
    });
    assert.equal(issued.status, 'issued');
    assert.ok(issued.credential);
    const decision = await service.authorize(`/rtc?vr_gate_credential=${issued.credential.value}`);
    if (roomId === 'bootstrap-main') assert.equal(decision.ok, true);
    else {
      assert.equal(decision.ok, false);
      assert.ok(!decision.ok);
      assert.equal(decision.code, 'widget_unavailable');
    }
  }
  await setTimeout(300);
  const owner = await database.pool.query<{ owner_id: string; acknowledged_generation: string | null }>(
    "SELECT owner_id,acknowledged_generation::text FROM widget_runtime_owners WHERE role='gate'"
  );
  assert.equal(owner.rows[0]?.owner_id, oldOwner);
  assert.equal(owner.rows[0]?.acknowledged_generation, null);
});

test('gate readiness still fails until the ordinary credential schema exists', async (t) => {
  const database = await createTestDatabase(t);
  const service = createLiveKitAuthGateService({ pool: database.pool, secret: 'test-gate-secret-at-least-32-bytes' });
  const server = service.createServer();
  t.after(async () => {
    await service.stop();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await database.cleanup();
  });
  await service.start();
  await database.pool.query('ALTER TABLE livekit_gate_credentials RENAME TO pending_livekit_gate_credentials');
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const readinessUrl = `http://127.0.0.1:${address.port}/readyz`;
  assert.equal((await fetch(readinessUrl)).status, 503);
  await database.pool.query('ALTER TABLE pending_livekit_gate_credentials RENAME TO livekit_gate_credentials');
  assert.equal((await fetch(readinessUrl)).status, 200);
});
