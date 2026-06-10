'use strict';

const crypto = require('node:crypto');

function hasLeadingZeroBits(buffer, bits) {
  const fullBytes = Math.floor(bits / 8);
  const remainingBits = bits % 8;

  for (let index = 0; index < fullBytes; index += 1) {
    if (buffer[index] !== 0) return false;
  }

  if (remainingBits === 0) return true;
  const mask = 0xff << (8 - remainingBits);
  return (buffer[fullBytes] & mask) === 0;
}

function parsePowChallenge(challenge) {
  if (typeof challenge !== 'string') return null;

  const parts = challenge.split('.');
  if (parts.length !== 4) return null;

  const [challengeId, issuedAtValue, difficultyValue, signature] = parts;
  const issuedAt = Number.parseInt(issuedAtValue, 10);
  const difficulty = Number.parseInt(difficultyValue, 10);
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(challengeId)) return null;
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) return null;
  if (!Number.isFinite(difficulty) || difficulty < 0 || difficulty > 32) return null;
  if (!/^[A-Za-z0-9_-]{32,96}$/.test(signature)) return null;

  return { challengeId, difficulty, issuedAt, signature };
}

function normalizePowNonce(value) {
  if (Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && /^(0|[1-9]\d{0,15})$/.test(value)) return value;
  return '';
}

function timingSafeMatch(expected, actual) {
  if (!expected || !actual || expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

// Stateful proof-of-work guard for room creation: signs challenges with an HMAC
// keyed by the client IP and tracks spent challenges to prevent replay.
function createProofOfWork({ secret = crypto.randomBytes(32), difficulty, ttlMs }) {
  const usedChallenges = new Map();

  function sign(payload, clientIp) {
    return crypto.createHmac('sha256', secret).update(`${clientIp}:${payload}`).digest('base64url');
  }

  function prune(now = Date.now()) {
    for (const [challengeId, expiresAt] of usedChallenges) {
      if (expiresAt <= now) usedChallenges.delete(challengeId);
    }
  }

  function createChallenge(clientIp, now = Date.now()) {
    if (difficulty <= 0) return null;
    const challengeId = crypto.randomBytes(16).toString('base64url');
    const payload = `${challengeId}.${now}.${difficulty}`;
    return `${payload}.${sign(payload, clientIp)}`;
  }

  function verify(clientIp, proof, now = Date.now()) {
    if (difficulty <= 0) return { ok: true };
    prune(now);

    const challenge = typeof proof?.challenge === 'string' ? proof.challenge : '';
    const nonce = normalizePowNonce(proof?.nonce);
    const parsed = parsePowChallenge(challenge);
    if (!parsed || !nonce) {
      return { ok: false, status: 403, error: 'Room creation proof is required' };
    }

    const { challengeId, difficulty: proofDifficulty, issuedAt, signature } = parsed;
    const payload = `${challengeId}.${issuedAt}.${proofDifficulty}`;
    const expectedSignature = sign(payload, clientIp);
    if (proofDifficulty !== difficulty || !timingSafeMatch(expectedSignature, signature)) {
      return { ok: false, status: 403, error: 'Invalid room creation proof' };
    }

    if (now < issuedAt || now - issuedAt > ttlMs) {
      return { ok: false, status: 403, error: 'Room creation proof expired' };
    }

    if (usedChallenges.has(challengeId)) {
      return { ok: false, status: 403, error: 'Room creation proof was already used' };
    }

    const digest = crypto.createHash('sha256').update(`${challenge}:${nonce}`).digest();
    if (!hasLeadingZeroBits(digest, proofDifficulty)) {
      return { ok: false, status: 403, error: 'Invalid room creation proof' };
    }

    usedChallenges.set(challengeId, now + ttlMs);
    return { ok: true };
  }

  return { sign, prune, createChallenge, verify, usedChallenges };
}

module.exports = {
  hasLeadingZeroBits,
  parsePowChallenge,
  normalizePowNonce,
  createProofOfWork
};
