'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cjs = require('../src/moderation.js');

const base = { id: 'ban-1', roomId: 'room-1', createdAt: 1, updatedAt: 1, expiresAt: null, reason: '' };

async function contracts() {
  return [cjs, await import('../src/moderation.mjs')];
}

test('G88-C01 account bans keep a sanitized profile of the banned user', async () => {
  for (const contract of await contracts()) {
    const ban = contract.normalizeActiveBan({
      ...base,
      subject: {
        userId: 'user-1',
        profile: { displayName: 'Анна', login: 'anna', avatarUrl: '/api/avatars/a.webp', avatarColorKey: 'coral', avatarAccent: '' }
      }
    });
    assert.deepEqual(ban.subject, {
      kind: 'account',
      userId: 'user-1',
      profile: { displayName: 'Анна', login: 'anna', avatarUrl: '/api/avatars/a.webp', avatarColorKey: 'coral', avatarAccent: null }
    });

    const foreignAvatar = contract.normalizeActiveBan({
      ...base,
      subject: { userId: 'user-1', profile: { login: 'anna', avatarUrl: 'https://example.com/a.png' } }
    });
    assert.equal(foreignAvatar.subject.profile.avatarUrl, null);
  }
});

test('G88-C02 guests and profiles without a login stay profile-free', async () => {
  for (const contract of await contracts()) {
    assert.deepEqual(
      contract.normalizeActiveBan({ ...base, subject: { userId: 'user-1', profile: { displayName: 'Без логина' } } }).subject,
      { kind: 'account', userId: 'user-1' }
    );
    assert.deepEqual(
      contract.normalizeActiveBan({ ...base, subject: { userId: null, profile: { login: 'guest' } } }).subject,
      { kind: 'guest', userId: null }
    );
    assert.deepEqual(contract.normalizeActiveBan({ ...base, userId: 'user-2' }).subject, { kind: 'account', userId: 'user-2' });
  }
});
