// Closing the registry's pool drops every service built on it: none keeps
// querying the ended pool, and the next pool serves them all.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServiceRegistry, type ServiceRegistryDeps } from '../src/app/service-registry.ts';
import { fake, fakeDb } from './fakes/index.ts';
import { defined } from './helpers/assert-defined.ts';

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

// Each case reads through one service the registry builds on its pool.
function queryEach(registry: ReturnType<typeof createServiceRegistry>) {
  return Promise.all([
    defined(registry.getAdminActionRepository(), 'admin actions').listFor('user-1'),
    defined(registry.getAccountStandingRepository(), 'account standing').listBadges(),
    defined(registry.getAdminRoomsRepository(), 'admin rooms').rooms(['room-1']),
    defined(registry.getReportRepository(), 'reports').countOpen()
  ]);
}

test('after close no service is left on the ended pool, and a new pool serves them all', async () => {
  const first = fakeDb();
  const registry = createServiceRegistry(CONFIG, fake<ServiceRegistryDeps>());
  registry.applyOverrides({ pool: first });
  await queryEach(registry);
  const firstCalls = first.calls.length;
  assert.ok(firstCalls >= 4, 'each service queried the first pool');

  await registry.close(fake());
  assert.equal(registry.getAdminActionRepository(), null, 'no admin actions without a pool');
  assert.equal(registry.getAccountStandingRepository(), null, 'no account standing without a pool');
  assert.equal(registry.getAdminRoomsRepository(), null, 'no admin rooms without a pool');

  const second = fakeDb();
  registry.applyOverrides({ pool: second });
  await queryEach(registry);
  assert.equal(first.calls.length, firstCalls, 'nothing reached the ended pool');
  assert.ok(second.calls.length >= 4, 'each service queried the new pool');
});
