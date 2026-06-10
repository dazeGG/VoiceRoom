'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  hasLeadingZeroBits,
  parsePowChallenge,
  normalizePowNonce,
  createProofOfWork
} = require('../lib/pow');

// Brute-forces a nonce the same way the browser client does.
function solveChallenge(challenge, difficulty) {
  for (let nonce = 0; nonce < 1_000_000; nonce += 1) {
    const digest = crypto.createHash('sha256').update(`${challenge}:${nonce}`).digest();
    if (hasLeadingZeroBits(digest, difficulty)) return nonce;
  }
  throw new Error('nonce not found');
}

test('hasLeadingZeroBits checks whole and partial bytes', () => {
  assert.equal(hasLeadingZeroBits(Buffer.from([0x00, 0x00, 0xff]), 16), true);
  assert.equal(hasLeadingZeroBits(Buffer.from([0x00, 0x01]), 16), false);
  assert.equal(hasLeadingZeroBits(Buffer.from([0x0f]), 4), true);
  assert.equal(hasLeadingZeroBits(Buffer.from([0x1f]), 4), false);
  assert.equal(hasLeadingZeroBits(Buffer.from([0xff]), 0), true);
});

test('parsePowChallenge accepts a well-formed challenge', () => {
  const id = crypto.randomBytes(16).toString('base64url');
  const sig = crypto.randomBytes(32).toString('base64url');
  const parsed = parsePowChallenge(`${id}.1700000000000.14.${sig}`);
  assert.ok(parsed);
  assert.equal(parsed.challengeId, id);
  assert.equal(parsed.issuedAt, 1700000000000);
  assert.equal(parsed.difficulty, 14);
});

test('parsePowChallenge rejects malformed challenges', () => {
  assert.equal(parsePowChallenge('a.b.c'), null);
  assert.equal(parsePowChallenge('short.1.14.sig'), null);
  assert.equal(parsePowChallenge(42), null);
  assert.equal(parsePowChallenge(''), null);
});

test('normalizePowNonce accepts safe integers and numeric strings', () => {
  assert.equal(normalizePowNonce(0), '0');
  assert.equal(normalizePowNonce(123), '123');
  assert.equal(normalizePowNonce('456'), '456');
  assert.equal(normalizePowNonce(-1), '');
  assert.equal(normalizePowNonce('01'), '');
  assert.equal(normalizePowNonce('abc'), '');
  assert.equal(normalizePowNonce(1.5), '');
});

test('proof of work is disabled when difficulty <= 0', () => {
  const pow = createProofOfWork({ difficulty: 0, ttlMs: 60000 });
  assert.equal(pow.createChallenge('1.2.3.4'), null);
  assert.deepEqual(pow.verify('1.2.3.4', {}), { ok: true });
});

test('a solved proof verifies successfully', () => {
  const pow = createProofOfWork({ difficulty: 8, ttlMs: 60000 });
  const ip = '1.2.3.4';
  const challenge = pow.createChallenge(ip);
  const nonce = solveChallenge(challenge, 8);
  assert.deepEqual(pow.verify(ip, { challenge, nonce }), { ok: true });
});

test('a proof from a different IP is rejected', () => {
  const pow = createProofOfWork({ difficulty: 8, ttlMs: 60000 });
  const challenge = pow.createChallenge('1.2.3.4');
  const nonce = solveChallenge(challenge, 8);
  const result = pow.verify('9.9.9.9', { challenge, nonce });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
});

test('a replayed proof is rejected the second time', () => {
  const pow = createProofOfWork({ difficulty: 8, ttlMs: 60000 });
  const ip = '1.2.3.4';
  const challenge = pow.createChallenge(ip);
  const nonce = solveChallenge(challenge, 8);
  assert.equal(pow.verify(ip, { challenge, nonce }).ok, true);
  const replay = pow.verify(ip, { challenge, nonce });
  assert.equal(replay.ok, false);
  assert.match(replay.error, /already used/);
});

test('an expired challenge is rejected', () => {
  const pow = createProofOfWork({ difficulty: 8, ttlMs: 1000 });
  const ip = '1.2.3.4';
  const issuedAt = 10_000;
  const challenge = pow.createChallenge(ip, issuedAt);
  const nonce = solveChallenge(challenge, 8);
  const result = pow.verify(ip, { challenge, nonce }, issuedAt + 2000);
  assert.equal(result.ok, false);
  assert.match(result.error, /expired/);
});

test('a tampered signature is rejected', () => {
  const pow = createProofOfWork({ difficulty: 8, ttlMs: 60000 });
  const ip = '1.2.3.4';
  const challenge = pow.createChallenge(ip);
  const nonce = solveChallenge(challenge, 8);
  const parts = challenge.split('.');
  parts[3] = crypto.randomBytes(32).toString('base64url');
  const tampered = parts.join('.');
  assert.equal(pow.verify(ip, { challenge: tampered, nonce }).ok, false);
});

test('a wrong nonce that misses the difficulty target is rejected', () => {
  const pow = createProofOfWork({ difficulty: 12, ttlMs: 60000 });
  const ip = '1.2.3.4';
  const challenge = pow.createChallenge(ip);
  const result = pow.verify(ip, { challenge, nonce: 1 });
  assert.equal(result.ok, false);
});
