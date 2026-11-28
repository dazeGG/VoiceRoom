import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from 'typebox/value';
import { AdminActionKind } from '../src/contracts/admin.ts';
import { isErrorCode } from '../src/contracts/errors.ts';
import { ROLE_PERMISSIONS, roleAllows } from '../src/contracts/staff.ts';
import { SupportRead, SupportTextBody, SupportThread, SupportThreadsQuery } from '../src/contracts/support.ts';
import { OFFICIAL_ACCOUNT_ID, isOfficialAccount } from '../src/official-account.ts';

test('only a superadmin answers in the support inbox', () => {
  assert.equal(roleAllows('superadmin', 'support.reply'), true);
  assert.equal(roleAllows('admin', 'support.reply'), false);
  assert.equal(roleAllows('moderator', 'support.reply'), false);
  assert.equal(ROLE_PERMISSIONS.admin.includes('support.reply'), false);
});

test('the official account is known by its id, not by a badge', () => {
  assert.equal(isOfficialAccount({ id: OFFICIAL_ACCOUNT_ID }), true);
  assert.equal(isOfficialAccount({ id: 'someone-with-the-official-badge' }), false);
  assert.equal(isOfficialAccount(null), false);
});

test('support bodies, queries, error codes and log entries', () => {
  assert.equal(Value.Check(SupportTextBody, { text: 'Привет' }), true);
  assert.equal(Value.Check(SupportTextBody, { text: '' }), false);
  assert.equal(Value.Check(SupportTextBody, { text: 'x'.repeat(2001) }), false);
  assert.equal(Value.Check(SupportThreadsQuery, { status: 'resolved' }), true);
  assert.equal(Value.Check(SupportThreadsQuery, { status: 'closed' }), false);
  for (const code of [
    'official_account',
    'support_thread_not_found',
    'support_conversation_deleted',
    'support_thread_changed'
  ])
    assert.equal(isErrorCode(code), true, code);
  for (const action of ['support_reply', 'support_note', 'support_resolve'])
    assert.equal(Value.Check(AdminActionKind, action), true, action);
  const thread = {
    ok: true,
    person: {
      id: 'u',
      login: 'kira',
      displayName: 'Кира',
      avatarUrl: null,
      avatarColorKey: 'blue',
      avatarAccent: null
    },
    personState: 'active',
    official: {
      displayName: 'VoiceRoom',
      avatarUrl: '/api/avatars/av.webp',
      avatarColorKey: 'olive',
      avatarAccent: null
    },
    status: 'open',
    resolvedAt: null,
    conversationDeleted: false,
    messages: [{ id: 'm', fromPerson: false, body: 'Ответ', createdAt: 1, attachments: [], staffName: 'Root' }],
    notes: []
  };
  assert.equal(Value.Check(SupportThread, thread), true);
  assert.equal(Value.Check(SupportThread, { ...thread, personState: 'banned' }), false);
  assert.equal(Value.Check(SupportRead, { ok: true, openUnread: 2 }), true);
});
