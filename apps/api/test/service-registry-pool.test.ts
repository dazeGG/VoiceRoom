// The registry's stores and repositories share the one pool bootstrap installs,
// and closing the registry ends that pool once.

import test from 'node:test';
import assert from 'node:assert/strict';
import type pg from 'pg';
import { createServiceRegistry, type ServiceRegistryDeps } from '../src/app/service-registry.ts';
import { fake, fakeDb } from './fakes/index.ts';

const CONFIG = {
  ROOM_IDLE_TTL_MS: 60_000,
  SESSION_TTL_MS: 60_000,
  GEOIP_DB_PATH: '',
  LIVEKIT_GATE_SECRET: 'gate-secret-for-tests-0123456789abcdef',
  LIVEKIT_GATE_CREDENTIAL_TTL_SECONDS: 60,
  LIVEKIT_TOKEN_TTL_SECONDS: 60,
  MAX_ROOM_BANS: 10,
  MAX_PUSH_SUBSCRIPTIONS_PER_USER: 5,
  LINK_PREVIEWS_ENABLED: false
};

test('stores built by the registry query the installed pool, and close ends it once', async () => {
  const db = fakeDb();
  let ends = 0;
  const pool: pg.Pool = Object.assign(db, {
    async end() {
      ends += 1;
    }
  });
  const registry = createServiceRegistry(CONFIG, fake<ServiceRegistryDeps>());
  registry.applyOverrides({ pool });

  await registry.getUserStore().getUserById('11111111-1111-4111-8111-111111111111');
  await registry.getPushStore().listByUserId('11111111-1111-4111-8111-111111111111');
  assert.equal(db.calls.length, 2, 'both stores sent their query through the one pool');
  assert.equal(registry.getPool(), pool);

  await registry.close(fake());
  assert.equal(ends, 1);
  assert.equal(registry.getPool(), null);
});

test('without a pool the registry still builds services, which fail once they query', async () => {
  const registry = createServiceRegistry(CONFIG, fake<ServiceRegistryDeps>());
  assert.equal(registry.getPool(), null);
  await assert.rejects(registry.getUserStore().getUserById('someone'), /No PostgreSQL pool is installed/);
});
