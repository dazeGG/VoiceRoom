import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canCall,
  canMessage,
  canRead,
  canType,
  officialExemption,
  type ContactFacts
} from '../../../src/domains/social/contact.policy.ts';

const limits = { daily: 10, unanswered: 3 };
const stranger: ContactFacts = {
  senderId: 'a',
  friends: false,
  blocked: false,
  active: true,
  hasMessages: false,
  messagesFrom: 'everyone',
  callsFrom: 'friends',
  selectedForMessages: false,
  selectedForCalls: false,
  newChatsToday: 0,
  pair: null,
  senderOfficial: false,
  recipientOfficial: false
};

test('contact audiences apply independently, with blocks taking precedence', () => {
  assert.equal(canMessage(stranger, limits), 'allowed');
  assert.equal(canCall(stranger), 'friends_only');
  assert.equal(canCall({ ...stranger, friends: true }), 'allowed');
  const selected: ContactFacts = {
    ...stranger,
    friends: true,
    messagesFrom: 'selected',
    callsFrom: 'selected',
    selectedForCalls: true
  };
  assert.equal(canMessage(selected, limits), 'not_selected');
  assert.equal(canCall(selected), 'allowed');
  assert.equal(canMessage({ ...selected, selectedForMessages: true }, limits), 'allowed');
  assert.equal(canCall({ ...selected, blocked: true }), 'blocked');
  assert.equal(canType({ ...selected, blocked: true }, limits), 'blocked');
  assert.equal(canRead({ ...stranger, blocked: true, hasMessages: true }, limits), 'allowed');
  assert.equal(canRead({ ...stranger, blocked: true }, limits), 'blocked');
});

test('the new-chat cap ignores existing pairs and the unanswered cap applies to the last sender', () => {
  const capped = { ...stranger, newChatsToday: 10 };
  assert.equal(canMessage({ ...capped, newChatsToday: 9 }, limits), 'allowed');
  assert.equal(canMessage(capped, limits), 'chat_cap');
  assert.equal(canMessage({ ...capped, friends: true }, limits), 'allowed');
  assert.equal(canMessage({ ...capped, hasMessages: true }, limits), 'allowed');
  assert.equal(canMessage({ ...capped, pair: { last_sender_id: 'b', unanswered_count: 3 } }, limits), 'allowed');
  assert.equal(canMessage({ ...capped, pair: { last_sender_id: 'a', unanswered_count: 3 } }, limits), 'unanswered_cap');
});

test('anyone writes to the official account without friendship, settings or caps; it never writes, calls or is called', () => {
  const toOfficial: ContactFacts = {
    ...stranger,
    recipientOfficial: true,
    messagesFrom: 'friends',
    callsFrom: 'everyone',
    newChatsToday: 10,
    pair: { last_sender_id: 'a', unanswered_count: 3 }
  };
  assert.equal(officialExemption(toOfficial), true);
  assert.equal(canMessage(toOfficial, limits), 'allowed');
  assert.equal(canType(toOfficial, limits), 'allowed');
  assert.equal(canRead(toOfficial, limits), 'allowed');
  assert.equal(canMessage({ ...toOfficial, active: false }, limits), 'blocked');
  assert.equal(canCall(toOfficial), 'blocked');
  const fromOfficial: ContactFacts = { ...stranger, senderOfficial: true, messagesFrom: 'everyone', friends: true };
  assert.equal(officialExemption(fromOfficial), false);
  assert.equal(canMessage(fromOfficial, limits), 'blocked');
  assert.equal(canCall({ ...fromOfficial, callsFrom: 'everyone' }), 'blocked');
  assert.equal(officialExemption({ senderOfficial: true, recipientOfficial: true }), false);
});
