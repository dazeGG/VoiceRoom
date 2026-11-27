// The 1:1 call E2EE key agreement state each side publishes in its LiveKit attribute: the parser accepts the v1
// shape, reports a newer protocol as unsupported, and drops anything malformed instead of acting on it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { CALL_KEY_RING_SIZE, parseCallKeyAgreementState } from '../src/contracts/rings.ts';

const sid = 'ab'.repeat(16);
const hs = 'cd'.repeat(16);
const key = 'ef'.repeat(32);

test('a v1 state parses, from the bare presence to the initiator reveal and the responder hello', () => {
  assert.deepEqual(parseCallKeyAgreementState(JSON.stringify({ v: 1, sid, red: true })), { v: 1, sid, red: true });
  const reveal = { v: 1, sid, red: false, hs, to: sid, index: CALL_KEY_RING_SIZE - 1, commit: key, reveal: key };
  assert.deepEqual(parseCallKeyAgreementState(JSON.stringify(reveal)), reveal);
  const hello = { v: 1, sid, red: true, hs, hello: key };
  assert.deepEqual(parseCallKeyAgreementState(JSON.stringify(hello)), hello);
});

test('a state from a newer protocol version is unsupported, not malformed', () => {
  assert.equal(parseCallKeyAgreementState(JSON.stringify({ v: 2, sid, red: true })), 'unsupported');
  assert.equal(parseCallKeyAgreementState(JSON.stringify({ v: 7 })), 'unsupported');
});

test('missing, unparsable or malformed states give nothing to act on', () => {
  for (const raw of [
    undefined,
    '',
    '{not json',
    'null',
    JSON.stringify({ v: 0, sid, red: true }),
    JSON.stringify({ v: '1', sid, red: true }),
    JSON.stringify({ v: 1, sid: 'AB'.repeat(16), red: true }),
    JSON.stringify({ v: 1, sid, red: 'yes' }),
    JSON.stringify({ v: 1, sid, red: true, hs: 'short' }),
    JSON.stringify({ v: 1, sid, red: true, commit: 'zz'.repeat(32) }),
    JSON.stringify({ v: 1, sid, red: true, index: CALL_KEY_RING_SIZE }),
    JSON.stringify({ v: 1, sid, red: true, index: 1.5 })
  ]) {
    assert.equal(parseCallKeyAgreementState(raw), undefined, String(raw));
  }
});
