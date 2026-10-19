import crypto from 'node:crypto';
import { isRecord } from '../../platform/record.ts';

const CREDENTIAL_PREFIX = 'vrg1';

export type GatePrincipalType = 'account' | 'guest';

export type GateClaims = {
  cid: string;
  exp: number;
  iat: number;
  peer: string;
  pEpoch: number;
  pId: string;
  pType: GatePrincipalType;
  room: string;
};

export type GateVerification =
  | { ok: true; claims: GateClaims }
  | { ok: false; code: 'malformed' | 'bad_signature' | 'malformed_payload' }
  | { ok: false; code: 'invalid_claims' | 'issued_in_future' | 'expired'; claims: Record<string, unknown> };

export type GateSignInput = {
  credentialId?: string;
  expiresAt?: number;
  issuedAt?: number;
  peerId?: string;
  principalEpoch?: number;
  principalId?: string;
  principalType?: string;
  roomId?: string;
};

export type GateCredentialSigner = {
  hash(credential: string): string;
  sign(input?: GateSignInput): string;
  verify(credential: unknown): GateVerification;
};

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function parseBase64urlJson(value: string): unknown {
  const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  return parsed;
}

function isPrincipalType(value: unknown): value is GatePrincipalType {
  return value === 'account' || value === 'guest';
}

function hashGateCredential(credential: string): string {
  return crypto.createHash('sha256').update(credential).digest('hex');
}

function signPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function normalizeGateSecret(secret: unknown): string {
  const value = typeof secret === 'string' ? secret.trim() : '';
  if (value.length < 32) {
    throw new Error('LIVEKIT_GATE_SECRET must be at least 32 characters');
  }
  return value;
}

function createGateCredentialSigner({
  secret,
  now = Date.now,
  maxFutureSkewMs = 30_000
}: {
  secret?: unknown;
  now?: () => number;
  maxFutureSkewMs?: number;
} = {}): GateCredentialSigner {
  const signingSecret = normalizeGateSecret(secret);
  const nowMs = now;

  function sign({
    credentialId = crypto.randomUUID(),
    expiresAt,
    issuedAt = nowMs(),
    peerId,
    principalEpoch,
    principalId,
    principalType,
    roomId
  }: GateSignInput = {}): string {
    const body = {
      cid: credentialId || '',
      exp: Number(expiresAt),
      iat: Number(issuedAt),
      peer: peerId || '',
      pEpoch: Number(principalEpoch),
      pId: principalId || '',
      pType: principalType || '',
      room: roomId || ''
    };
    if (!body.cid || !body.room || !body.peer || !body.pId || !['account', 'guest'].includes(body.pType)) {
      throw new Error('Invalid gate credential payload');
    }
    if (
      !Number.isSafeInteger(body.pEpoch) ||
      body.pEpoch < 0 ||
      !Number.isFinite(body.iat) ||
      !Number.isFinite(body.exp) ||
      body.exp <= body.iat
    ) {
      throw new Error('Invalid gate credential epoch or time claims');
    }
    const payload = base64urlJson(body);
    const signature = signPayload(payload, signingSecret);
    return `${CREDENTIAL_PREFIX}.${payload}.${signature}`;
  }

  function verify(credential: unknown): GateVerification {
    const parts = (typeof credential === 'string' ? credential : '').split('.');
    const [prefix, payload, signature] = parts;
    if (parts.length !== 3 || prefix !== CREDENTIAL_PREFIX || payload === undefined || signature === undefined)
      return { ok: false, code: 'malformed' };
    const expected = signPayload(payload, signingSecret);
    if (
      signature.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      return { ok: false, code: 'bad_signature' };
    }
    let claims: unknown;
    try {
      claims = parseBase64urlJson(payload);
    } catch {
      return { ok: false, code: 'malformed_payload' };
    }
    // Only this signer writes payloads, so a signed one is always an object.
    if (!isRecord(claims)) return { ok: false, code: 'malformed_payload' };
    const { cid, room, peer, pId, pType, iat, exp } = claims;
    const pEpoch = Number(claims.pEpoch);
    if (
      typeof cid !== 'string' ||
      !cid ||
      typeof room !== 'string' ||
      !room ||
      typeof peer !== 'string' ||
      !peer ||
      typeof pId !== 'string' ||
      !pId ||
      !isPrincipalType(pType) ||
      typeof iat !== 'number' ||
      !Number.isFinite(iat) ||
      typeof exp !== 'number' ||
      !Number.isFinite(exp) ||
      !Number.isSafeInteger(pEpoch) ||
      pEpoch < 0 ||
      exp <= iat
    ) {
      return { ok: false, code: 'invalid_claims', claims };
    }
    if (iat > nowMs() + Math.max(0, maxFutureSkewMs || 0)) {
      return { ok: false, code: 'issued_in_future', claims };
    }
    if (exp <= nowMs()) return { ok: false, code: 'expired', claims };
    return { ok: true, claims: { cid, exp, iat, peer, pEpoch, pId, pType, room } };
  }

  return {
    hash: hashGateCredential,
    sign,
    verify
  };
}

export { createGateCredentialSigner };
