import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { readEnvInt, readEnvBool, readDatabaseConfig, readUploadsDir } from '../src/lib/config.ts';
import { readApiConfig } from '../src/app/config.ts';

test('readEnvInt parses a valid integer', () => {
  assert.equal(readEnvInt('PORT', 3000, 1, { PORT: '8080' }), 8080);
});

test('readEnvInt falls back when missing', () => {
  assert.equal(readEnvInt('PORT', 3000, 1, {}), 3000);
});

test('readEnvInt falls back when empty', () => {
  assert.equal(readEnvInt('PORT', 3000, 1, { PORT: '' }), 3000);
  assert.equal(readEnvInt('PORT', 3000, 1, { PORT: '  ' }), 3000);
});

// A typo in a limit must stop the start, not quietly run with the default:
// MAX_VOICE_PEERS=6OO used to leave the server uncapped.
test('readEnvInt refuses a value below min', () => {
  assert.throws(() => readEnvInt('PORT', 3000, 1024, { PORT: '80' }), /PORT must be an integer of at least 1024/);
});

test('readEnvInt refuses a value that is not a whole number', () => {
  for (const value of ['abc', '6OO', '15000.5', '1e3', '12 rooms']) {
    assert.throws(() => readEnvInt('MAX_VOICE_PEERS', 0, 0, { MAX_VOICE_PEERS: value }), /MAX_VOICE_PEERS/, value);
  }
});

test('readEnvBool reads truthy strings', () => {
  for (const value of ['1', 'true', 'TRUE', 'yes', 'on', ' true ']) {
    assert.equal(readEnvBool('TRUST_PROXY', false, { TRUST_PROXY: value }), true, value);
  }
});

test('readEnvBool reads falsey strings', () => {
  for (const value of ['0', 'false', 'no', 'off', '']) {
    assert.equal(readEnvBool('TRUST_PROXY', true, { TRUST_PROXY: value }), false, value);
  }
});

test('readEnvBool returns fallback when undefined', () => {
  assert.equal(readEnvBool('TRUST_PROXY', true, {}), true);
  assert.equal(readEnvBool('TRUST_PROXY', false, {}), false);
});

test('readUploadsDir uses an absolute configured directory', () => {
  assert.equal(readUploadsDir({ UPLOADS_DIR: ' /data/uploads ' }), path.resolve('/data/uploads'));
});

test('readUploadsDir defaults to an ignored API-local directory', () => {
  assert.equal(readUploadsDir({}), path.resolve(import.meta.dirname, '../uploads'));
});

test('readDatabaseConfig requires DATABASE_URL', () => {
  assert.throws(() => readDatabaseConfig({}), /DATABASE_URL is required/);
});

test('readDatabaseConfig rejects malformed DATABASE_URL', () => {
  assert.throws(() => readDatabaseConfig({ DATABASE_URL: 'not a url' }), /valid PostgreSQL connection URL/);
});

test('readDatabaseConfig rejects non-PostgreSQL protocols', () => {
  assert.throws(
    () => readDatabaseConfig({ DATABASE_URL: 'mysql://user:pass@localhost/db' }),
    /postgres:\/\/ or postgresql:\/\//
  );
});

test('readDatabaseConfig accepts postgres URLs', () => {
  assert.deepEqual(readDatabaseConfig({ DATABASE_URL: 'postgres://user:pass@localhost:5432/voice_room' }), {
    url: 'postgres://user:pass@localhost:5432/voice_room'
  });
  assert.deepEqual(readDatabaseConfig({ DATABASE_URL: ' postgresql://user:pass@localhost/voice_room ' }), {
    url: 'postgresql://user:pass@localhost/voice_room'
  });
});

// A feature that ships disabled is reachable only if compose hands the flag
// to the container. CLIENT_LOG_INTAKE_ENABLED was documented and read by the
// API but never passed, so no containerised deployment could turn the browser
// log intake on, whatever the host .env said.
test('compose passes every feature flag the API leaves disabled by default', () => {
  const root = path.join(import.meta.dirname, '../../..');
  const compose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');

  const apiBlock = compose.slice(compose.indexOf('\n  api:'), compose.indexOf('\n  message-delivery:'));
  const passed = new Set(Array.from(apiBlock.matchAll(/^ {6}([A-Z0-9_]+):/gm), (m) => m[1]));
  // A default-off flag: false with no env, true once its variable is set.
  const settings = (env: Record<string, string>) => new Map<string, unknown>(Object.entries(readApiConfig(env)));
  const base = settings({ NODE_ENV: 'production' });
  const defaultOff = [...base.keys()].filter(
    (name) => base.get(name) === false && settings({ NODE_ENV: 'production', [name]: 'true' }).get(name) === true
  );

  assert.ok(defaultOff.length > 0, 'expected the API to declare default-off flags');
  const unreachable = defaultOff.filter((name) => !passed.has(name));
  assert.deepEqual(unreachable, [], `compose never passes these flags to api: ${unreachable.join(', ')}`);
});
