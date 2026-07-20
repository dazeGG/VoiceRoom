'use strict';

const crypto = require('node:crypto');

const CREDENTIAL_PREFIX = 'vrg1';

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function parseBase64urlJson(value) {
  return JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
}

function hashGateCredential(credential) {
  return crypto.createHash('sha256').update(String(credential || '')).digest('hex');
}

function signPayload(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function normalizeGateSecret(secret) {
  const value = String(secret || '').trim();
  if (value.length < 32) {
    throw new Error('LIVEKIT_GATE_SECRET must be at least 32 characters');
  }
  return value;
}

function createGateCredentialSigner({ secret, now = Date.now } = {}) {
  const signingSecret = normalizeGateSecret(secret);
  const nowMs = typeof now === 'function' ? now : () => Date.now();

  function sign({
    credentialId = crypto.randomUUID(),
    expiresAt,
    issuedAt = nowMs(),
    peerId,
    principalEpoch,
    principalId,
    principalType,
    roomId
  } = {}) {
    const body = {
      cid: String(credentialId || ''),
      exp: Number(expiresAt),
      iat: Number(issuedAt),
      peer: String(peerId || ''),
      pEpoch: Number(principalEpoch),
      pId: String(principalId || ''),
      pType: String(principalType || ''),
      room: String(roomId || '')
    };
    if (!body.cid || !body.room || !body.peer || !body.pId || !['account', 'guest'].includes(body.pType)) {
      throw new Error('Invalid gate credential payload');
    }
    if (
      !Number.isSafeInteger(body.pEpoch)
      || body.pEpoch < 0
      || !Number.isFinite(body.iat)
      || !Number.isFinite(body.exp)
      || body.exp <= body.iat
    ) {
      throw new Error('Invalid gate credential epoch or time claims');
    }
    const payload = base64urlJson(body);
    const signature = signPayload(payload, signingSecret);
    return `${CREDENTIAL_PREFIX}.${payload}.${signature}`;
  }

  function verify(credential) {
    const parts = String(credential || '').split('.');
    if (parts.length !== 3 || parts[0] !== CREDENTIAL_PREFIX) return { ok: false, code: 'malformed' };
    const [, payload, signature] = parts;
    const expected = signPayload(payload, signingSecret);
    if (
      signature.length !== expected.length
      || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      return { ok: false, code: 'bad_signature' };
    }
    let claims;
    try {
      claims = parseBase64urlJson(payload);
    } catch {
      return { ok: false, code: 'malformed_payload' };
    }
    if (
      !Number.isFinite(claims.iat)
      || !Number.isFinite(claims.exp)
      || !Number.isSafeInteger(Number(claims.pEpoch))
      || Number(claims.pEpoch) < 0
      || claims.exp <= claims.iat
    ) {
      return { ok: false, code: 'invalid_claims', claims };
    }
    if (claims.exp <= nowMs()) return { ok: false, code: 'expired', claims };
    return { ok: true, claims };
  }

  return {
    hash: hashGateCredential,
    sign,
    verify
  };
}

module.exports = {
  CREDENTIAL_PREFIX,
  createGateCredentialSigner,
  hashGateCredential
};
