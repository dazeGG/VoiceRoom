import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from 'typebox/value';
import { DirectThread } from '../src/contracts/messages.ts';
import { PrivacySettings } from '../src/contracts/privacy.ts';
import { parseServerFrame } from '../src/realtime.ts';

test('an older direct thread response still validates and privacy audiences reject unknown values', () => {
  const peer = {
    id: 'bob',
    login: 'bob',
    displayName: 'Bob',
    avatarUrl: null,
    avatarAccent: null,
    avatarColorKey: 'blue',
    presenceStatus: 'offline',
    doNotDisturb: false,
    createdAt: null
  };
  assert.equal(Value.Check(DirectThread, { ok: true, peer, messages: [], muted: false }), true);
  assert.equal(Value.Check(PrivacySettings, { callsFrom: 'selected', messagesFrom: 'everyone' }), true);
  assert.equal(Value.Check(PrivacySettings, { callsFrom: 'nobody', messagesFrom: 'everyone' }), false);
});

test('the account privacy event accepts a validated update', () => {
  const frame = {
    type: 'account.privacy.updated',
    payload: { privacy: { messagesFrom: 'friends', callsFrom: 'selected', allowList: [] } }
  };
  assert.deepEqual(parseServerFrame(frame), { ok: true, frame });
});
