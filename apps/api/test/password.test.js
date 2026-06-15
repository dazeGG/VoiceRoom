'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { hashPassword, verifyPassword } = require('../src/lib/password');

test('hashPassword produces a self-describing scrypt string', async () => {
  const hash = await hashPassword('correct horse battery');
  const parts = hash.split('$');
  assert.equal(parts.length, 6);
  assert.equal(parts[0], 'scrypt');
  assert.equal(parts[1], '16384');
});

test('hashPassword salts each hash so two hashes of the same password differ', async () => {
  const first = await hashPassword('same-password');
  const second = await hashPassword('same-password');
  assert.notEqual(first, second);
});

test('verifyPassword accepts the correct password and rejects a wrong one', async () => {
  const hash = await hashPassword('s3cret-passphrase');
  assert.equal(await verifyPassword('s3cret-passphrase', hash), true);
  assert.equal(await verifyPassword('wrong-passphrase', hash), false);
});

test('verifyPassword rejects malformed stored values without throwing', async () => {
  assert.equal(await verifyPassword('anything', 'not-a-valid-hash'), false);
  assert.equal(await verifyPassword('anything', 'scrypt$16384$8$1$onlyfive'), false);
  assert.equal(await verifyPassword('anything', ''), false);
  assert.equal(await verifyPassword('anything', null), false);
});
