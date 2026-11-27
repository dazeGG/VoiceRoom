// The per-call E2EE key agreement: both sides of a call end up with the same media key and 4-emoji code, every
// restart on either side gives a new key, and a relay that rewrites or substitutes keys is either refused or shows
// up as different codes.

import { createHash, hkdfSync } from 'node:crypto';
import { expect, test } from 'vitest';
import { parseCallKeyAgreementState } from '@voiceroom/shared/contracts/rings';
import {
  deriveCallKey,
  startKeyAgreement,
  type AgreedKey,
  type KeyAgreementChannel,
  type KeyAgreementFailure
} from '@voiceroom/call/engine/e2ee/key-agreement';
import { SAFETY_EMOJI, safetyCode } from '@voiceroom/call/engine/e2ee/safety-code';

const CALL = '7d2c9c51-6c11-4a56-9d3c-2f5a8e7b1c00';

type Rewrite = (state: string) => string;

// Two attribute slots and the listeners of each side, delivered asynchronously like the LiveKit signal path.
function link(rewrite: { toA?: Rewrite; toB?: Rewrite } = {}) {
  const slots: { a: string | undefined; b: string | undefined } = { a: undefined, b: undefined };
  const listeners = { a: new Set<() => void>(), b: new Set<() => void>() };
  const side = (self: 'a' | 'b'): KeyAgreementChannel => {
    const other = self === 'a' ? 'b' : 'a';
    const outgoing = self === 'a' ? rewrite.toB : rewrite.toA;
    return {
      async publish(state) {
        slots[self] = outgoing ? outgoing(state) : state;
        setTimeout(() => listeners[other].forEach((listener) => listener()), 1);
      },
      read: () => slots[other],
      subscribe(listener) {
        listeners[self].add(listener);
        return () => listeners[self].delete(listener);
      }
    };
  };
  return {
    a: side('a'),
    b: side('b'),
    clear(which: 'a' | 'b') {
      slots[which] = undefined;
    }
  };
}

function party(role: 'initiator' | 'responder', channel: KeyAgreementChannel, red = true) {
  const keys: AgreedKey[] = [];
  const failures: KeyAgreementFailure[] = [];
  let wake = () => {};
  const agreement = startKeyAgreement({
    role,
    callId: CALL,
    channel,
    red,
    stepTimeoutMs: 400,
    retries: 1,
    onKey(agreed) {
      keys.push(agreed);
      wake();
    },
    onFailure(reason) {
      failures.push(reason);
      wake();
    }
  });
  return {
    agreement,
    keys,
    key(index: number): AgreedKey {
      const agreed = keys[index];
      if (!agreed) throw new Error(`the ${role} has no key #${index}`);
      return agreed;
    },
    failures,
    async next(count: number, timeoutMs = 3_000) {
      const deadline = Date.now() + timeoutMs;
      while (keys.length + failures.length < count) {
        if (Date.now() > deadline) throw new Error(`no result #${count} from the ${role}`);
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, 20);
        });
      }
    }
  };
}

const hex = (buffer: ArrayBuffer) => Buffer.from(buffer).toString('hex');

test('both sides agree the same key, index and code, and learn whether the other side takes RED', async () => {
  const wire = link();
  const caller = party('initiator', wire.a, true);
  const callee = party('responder', wire.b, false);
  await Promise.all([caller.next(1), callee.next(1)]);
  caller.agreement.stop();
  callee.agreement.stop();

  const [mine, theirs] = [caller.key(0), callee.key(0)];
  expect(hex(mine.key)).toBe(hex(theirs.key));
  expect(mine.key.byteLength).toBe(32);
  expect(mine.code).toEqual(theirs.code);
  expect(mine.code).toHaveLength(4);
  expect(mine.index).toBe(0);
  expect(theirs.index).toBe(0);
  expect(mine.peerRed).toBe(false);
  expect(theirs.peerRed).toBe(true);
});

test('a callee reload gets a new key at the next index, and the caller never repeats a finished agreement', async () => {
  const wire = link();
  const caller = party('initiator', wire.a);
  const first = party('responder', wire.b);
  await Promise.all([caller.next(1), first.next(1)]);
  first.agreement.stop();
  wire.clear('b');

  const reloaded = party('responder', wire.b);
  await Promise.all([caller.next(2), reloaded.next(1)]);
  expect(hex(caller.key(1).key)).toBe(hex(reloaded.key(0).key));
  expect(hex(caller.key(1).key)).not.toBe(hex(caller.key(0).key));
  expect(caller.key(1).index).toBe(1);
  expect(reloaded.key(0).index).toBe(1);

  await new Promise((resolve) => setTimeout(resolve, 600));
  expect(caller.keys).toHaveLength(2);
  expect(caller.failures).toEqual([]);
  caller.agreement.stop();
  reloaded.agreement.stop();
});

test('a caller reload starts over and the callee follows to the new key', async () => {
  const wire = link();
  const first = party('initiator', wire.a);
  const callee = party('responder', wire.b);
  await Promise.all([first.next(1), callee.next(1)]);
  first.agreement.stop();
  wire.clear('a');

  const reloaded = party('initiator', wire.a);
  await Promise.all([reloaded.next(1), callee.next(2)]);
  expect(hex(reloaded.key(0).key)).toBe(hex(callee.key(1).key));
  expect(hex(callee.key(1).key)).not.toBe(hex(callee.key(0).key));
  reloaded.agreement.stop();
  callee.agreement.stop();
});

test('a reveal that does not match its commitment is refused and gives the callee no key', async () => {
  const forged = Buffer.alloc(32, 7).toString('hex');
  const wire = link({
    toB(state) {
      const parsed = parseCallKeyAgreementState(state);
      return parsed && parsed !== 'unsupported' && parsed.reveal
        ? JSON.stringify({ ...parsed, reveal: forged })
        : state;
    }
  });
  const caller = party('initiator', wire.a);
  const callee = party('responder', wire.b);
  await callee.next(1);
  expect(callee.failures).toEqual(['tampered']);
  expect(callee.keys).toEqual([]);
  caller.agreement.stop();
  callee.agreement.stop();
});

test('a relay that runs its own agreement with each side cannot make the two codes match', async () => {
  // The relay answers the caller as a responder and calls the callee as an initiator, with its own keys.
  const toCaller = link();
  const toCallee = link();
  const caller = party('initiator', toCaller.a);
  const relayAsCallee = party('responder', toCaller.b);
  const relayAsCaller = party('initiator', toCallee.a);
  const callee = party('responder', toCallee.b);
  await Promise.all([caller.next(1), callee.next(1), relayAsCallee.next(1), relayAsCaller.next(1)]);
  for (const side of [caller, relayAsCallee, relayAsCaller, callee]) side.agreement.stop();

  expect(hex(caller.key(0).key)).not.toBe(hex(callee.key(0).key));
  // Equal codes would need a 2^-24 coincidence; the commitment stops the relay from choosing them.
  expect(caller.key(0).code).not.toEqual(callee.key(0).code);
});

test('a callee that never answers ends in a timeout after the retries', async () => {
  const wire = link();
  // A peer that is present but silent: it published once and never answers a commit.
  await wire.b.publish(JSON.stringify({ v: 1, sid: 'ab'.repeat(16), red: true }));
  const caller = party('initiator', wire.a);
  await caller.next(1, 3_000);
  expect(caller.failures).toEqual(['timeout']);
  caller.agreement.stop();
});

test('a peer on a newer protocol version is reported, and malformed states are ignored', () => {
  expect(parseCallKeyAgreementState(JSON.stringify({ v: 2, sid: 'ab'.repeat(16), red: true }))).toBe('unsupported');
  for (const raw of [
    undefined,
    '',
    'not json',
    JSON.stringify({ v: 1, sid: 'short', red: true }),
    JSON.stringify({ v: 1, sid: 'ab'.repeat(16), red: 'yes' }),
    JSON.stringify({ v: 1, sid: 'ab'.repeat(16), red: true, hello: 'zz'.repeat(32) }),
    JSON.stringify({ v: 1, sid: 'ab'.repeat(16), red: true, index: 16 })
  ])
    expect(parseCallKeyAgreementState(raw)).toBeUndefined();
  expect(parseCallKeyAgreementState(JSON.stringify({ v: 1, sid: 'ab'.repeat(16), red: false, index: 3 }))).toEqual({
    v: 1,
    sid: 'ab'.repeat(16),
    red: false,
    index: 3
  });
});

test('the derivation matches an independent HKDF over the RFC 7748 X25519 shared secret', async () => {
  // RFC 7748 section 6.1: Alice's private key, Bob's public key and their shared secret.
  const alicePrivate = Buffer.from('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a', 'hex');
  const alicePublic = Buffer.from('8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a', 'hex');
  const bobPublic = Buffer.from('de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f', 'hex');
  const shared = Buffer.from('4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742', 'hex');
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), alicePrivate]);
  const privateKey = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'X25519' }, false, ['deriveBits']);
  const hs = '11'.repeat(16);
  const initiator = { sid: '22'.repeat(16), publicKey: new Uint8Array(alicePublic) };
  const responder = { sid: '33'.repeat(16), publicKey: new Uint8Array(bobPublic) };

  const derived = await deriveCallKey({
    privateKey,
    peerPublic: new Uint8Array(bobPublic),
    callId: CALL,
    hs,
    initiator,
    responder
  });

  const transcript = Buffer.concat([
    Buffer.from('voiceroom/e2ee/call/v1'),
    Buffer.from(CALL),
    Buffer.from(hs, 'hex'),
    Buffer.from(initiator.sid, 'hex'),
    Buffer.from(responder.sid, 'hex'),
    alicePublic,
    bobPublic
  ]);
  const expand = (label: string, length: number) =>
    Buffer.from(hkdfSync('sha256', shared, Buffer.from(CALL), Buffer.concat([transcript, Buffer.from(label)]), length));
  expect(hex(derived.key)).toBe(expand('media', 32).toString('hex'));
  const sas = expand('sas', 4);
  const bits = sas.readUIntBE(0, 3);
  expect(derived.code).toEqual(
    [bits >>> 18, (bits >>> 12) & 63, (bits >>> 6) & 63, bits & 63].map((i) => SAFETY_EMOJI[i])
  );
});

test('the emoji table is 64 distinct single emoji, frozen in protocol order', () => {
  expect(SAFETY_EMOJI).toHaveLength(64);
  expect(new Set(SAFETY_EMOJI).size).toBe(64);
  for (const emoji of SAFETY_EMOJI) expect([...new Intl.Segmenter().segment(emoji)]).toHaveLength(1);
  // Any reorder changes every code, so the order is pinned by hash.
  expect(createHash('sha256').update(SAFETY_EMOJI.join('')).digest('hex').slice(0, 16)).toMatchInlineSnapshot(
    `"dd00e48f62e2f9f2"`
  );
  expect(safetyCode(new Uint8Array([0, 0, 0]))).toEqual(['🐶', '🐶', '🐶', '🐶']);
  expect(safetyCode(new Uint8Array([0xff, 0xff, 0xff]))).toEqual(['🎁', '🎁', '🎁', '🎁']);
  expect(() => safetyCode(new Uint8Array(2))).toThrow(RangeError);
});
