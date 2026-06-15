'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createUserStore, publicUser } = require('../src/lib/user-store');
const { AVATAR_COLOR_KEYS } = require('@voice-room/shared/validation');

function createFakePool(handler) {
  const calls = [];
  return {
    calls,
    async query(text, values = []) {
      calls.push({ text, values });
      return handler(text, values);
    },
    async end() {}
  };
}

test('createUser stores a validated avatar color key and publicUser returns it', async () => {
  const pool = createFakePool((text, values) => {
    assert.match(text, /avatar_color_key/);
    assert.equal(values[4], 'rose');
    return {
      rows: [{
        id: values[0],
        login: values[1],
        display_name: values[2],
        password_hash: values[3],
        avatar_color_key: values[4],
        created_at: values[5]
      }],
      rowCount: 1
    };
  });
  const store = createUserStore({ pool });

  const result = await store.createUser({
    avatarColorKey: 'rose',
    displayName: 'Ada',
    login: 'ada',
    now: 1000,
    password: 'password123'
  });

  assert.equal(result.status, 'created');
  assert.equal(result.user.avatarColorKey, 'rose');
  assert.equal(publicUser(result.user).avatarColorKey, 'rose');
  assert.equal('passwordHash' in publicUser(result.user), false);
});

test('createUser falls back to a curated random avatar color for invalid input', async () => {
  const pool = createFakePool((text, values) => ({
    rows: [{
      id: values[0],
      login: values[1],
      display_name: values[2],
      password_hash: values[3],
      avatar_color_key: values[4],
      created_at: values[5]
    }],
    rowCount: 1
  }));
  const store = createUserStore({ pool });

  const result = await store.createUser({ avatarColorKey: 'neon-unbounded', login: 'grace', password: 'password123' });

  assert.ok(AVATAR_COLOR_KEYS.includes(result.user.avatarColorKey));
  assert.ok(AVATAR_COLOR_KEYS.includes(pool.calls[0].values[4]));
});
