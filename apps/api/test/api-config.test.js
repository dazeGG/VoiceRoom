// The environment the API reads at start-up (app/config.ts): defaults,
// overrides, bounds and the values derived from other variables.

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_REALTIME_RECONNECT_LEASE_MS, readApiConfig, readinessReadySetFromEnv, resolveRealtimeReconnectLeaseMs } from '../src/app/config.ts';

test('defaults are safe: opt-in features off, local bind, dev cookies', () => {
  const config = readApiConfig({});
  assert.equal(config.HOST, '127.0.0.1');
  assert.equal(config.PORT, 3000);
  assert.equal(config.TRUST_PROXY, false);
  assert.equal(config.LINK_PREVIEWS_ENABLED, false);
  assert.equal(config.CLIENT_LOG_INTAKE_ENABLED, false);
  assert.equal(config.SESSION_COOKIE_SECURE, false);
  assert.equal(config.MESSAGE_DIRECT_EMIT_ENABLED, true);
  assert.equal(config.MESSAGE_DELIVERY_LISTEN_ENABLED, true);
  assert.equal(config.MAX_TEMP_ROOMS_PER_IP, 1);
  assert.equal(config.CAPABILITY_API_REPLICA_ID, 'api-primary');
  assert.deepEqual(config.CAPABILITY_EXPECTED_API_REPLICA_IDS, ['api-primary']);
  assert.deepEqual(config.CAPABILITY_DESIRED, {});
  assert.equal(Object.isFrozen(config), true);
});

test('overrides, bounds and derived values', () => {
  const config = readApiConfig({
    HOST: ' 0.0.0.0 ',
    PORT: '8080',
    NODE_ENV: 'production',
    ROOM_CREATE_POW_DIFFICULTY: '99',
    MAX_EMPTY_ROOMS_PER_IP: '4',
    HOSTNAME: 'api-7',
    CAPABILITY_EXPECTED_API_REPLICA_IDS: 'api-1, api-2,,',
    CAPABILITY_DESIRED: '{"engagement":true}',
    LIVEKIT_URL: 'wss://sfu.example',
    LIVEKIT_GATE_SECRET: '  secret  '
  });
  assert.equal(config.HOST, '0.0.0.0');
  assert.equal(config.PORT, 8080);
  assert.equal(config.SESSION_COOKIE_SECURE, true);
  assert.equal(config.ROOM_CREATE_POW_DIFFICULTY, 32);
  assert.equal(config.MAX_TEMP_ROOMS_PER_IP, 4);
  assert.equal(config.CAPABILITY_API_REPLICA_ID, 'api-7');
  assert.deepEqual(config.CAPABILITY_EXPECTED_API_REPLICA_IDS, ['api-1', 'api-2']);
  assert.deepEqual(config.CAPABILITY_DESIRED, { engagement: true });
  assert.equal(config.LIVEKIT_GATE_PUBLIC_URL, 'wss://sfu.example');
  assert.equal(config.LIVEKIT_GATE_SECRET, 'secret');
  assert.deepEqual(readApiConfig({ CAPABILITY_DESIRED: 'not json' }).CAPABILITY_DESIRED, {});
  assert.deepEqual(readApiConfig({ CAPABILITY_DESIRED: 'null' }).CAPABILITY_DESIRED, {});
  assert.throws(() => readApiConfig({ MESSAGE_DELIVERY_CLAIM_ENABLED: 'true' }), /cannot both be enabled/);
});

test('ready sets and the reconnect lease', () => {
  assert.deepEqual([...readinessReadySetFromEnv('X', {})], []);
  assert.deepEqual([...readinessReadySetFromEnv('X', { X: ' a, b ,a ' })], ['a', 'b']);
  assert.equal(resolveRealtimeReconnectLeaseMs({}), DEFAULT_REALTIME_RECONNECT_LEASE_MS);
  assert.equal(resolveRealtimeReconnectLeaseMs({ REALTIME_RECONNECT_LEASE_MS: '5000' }), 5000);
  assert.equal(resolveRealtimeReconnectLeaseMs({ REALTIME_RECONNECT_LEASE_MS: '500' }), DEFAULT_REALTIME_RECONNECT_LEASE_MS);
  assert.equal(resolveRealtimeReconnectLeaseMs({ REALTIME_RECONNECT_LEASE_MS: '1.5' }), DEFAULT_REALTIME_RECONNECT_LEASE_MS);
});
