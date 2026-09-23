import crypto from 'node:crypto';

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
  credentialId?: unknown;
  expiresAt?: unknown;
  issuedAt?: unknown;
  peerId?: unknown;
  principalEpoch?: unknown;
  principalId?: unknown;
  principalType?: unknown;
  roomId?: unknown;
};

export type GateCredentialSigner = {
  hash(credential: unknown): string;
  sign(input?: GateSignInput): string;
  verify(credential: unknown): GateVerification;
};

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function parseBase64urlJson(value: unknown): Record<string, unknown> {
  return JSON.parse(Buffer.from(String(value || ''), 'base64url').toString('utf8'));
}

function hashGateCredential(credential: unknown): string {
  return crypto.createHash('sha256').update(String(credential || '')).digest('hex');
}

function signPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', String(secret || '')).update(payload).digest('base64url');
}

function normalizeGateSecret(secret: unknown): string {
  const value = String(secret || '').trim();
  if (value.length < 32) {
    throw new Error('LIVEKIT_GATE_SECRET must be at least 32 characters');
  }
  return value;
}

function createGateCredentialSigner({ secret, now = Date.now, maxFutureSkewMs = 30_000 }: {
  secret?: unknown;
  now?: unknown;
  maxFutureSkewMs?: unknown;
} = {}): GateCredentialSigner {
  const signingSecret = normalizeGateSecret(secret);
  const nowMs: () => number = typeof now === 'function' ? now as () => number : () => Date.now();

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

  function verify(credential: unknown): GateVerification {
    const parts = String(credential || '').split('.');
    if (parts.length !== 3 || parts[0] !== CREDENTIAL_PREFIX) return { ok: false, code: 'malformed' };
    const [, payload, signature] = parts as [string, string, string];
    const expected = signPayload(payload, signingSecret);
    if (
      signature.length !== expected.length
      || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      return { ok: false, code: 'bad_signature' };
    }
    let claims: Record<string, unknown>;
    try {
      claims = parseBase64urlJson(payload);
    } catch {
      return { ok: false, code: 'malformed_payload' };
    }
    if (
      typeof claims.cid !== 'string'
      || !claims.cid
      || typeof claims.room !== 'string'
      || !claims.room
      || typeof claims.peer !== 'string'
      || !claims.peer
      || typeof claims.pId !== 'string'
      || !claims.pId
      || !['account', 'guest'].includes(claims.pType as string)
      ||
      !Number.isFinite(claims.iat)
      || !Number.isFinite(claims.exp)
      || !Number.isSafeInteger(Number(claims.pEpoch))
      || Number(claims.pEpoch) < 0
      || (claims.exp as number) <= (claims.iat as number)
    ) {
      return { ok: false, code: 'invalid_claims', claims };
    }
    if ((claims.iat as number) > nowMs() + Math.max(0, Number(maxFutureSkewMs) || 0)) {
      return { ok: false, code: 'issued_in_future', claims };
    }
    if ((claims.exp as number) <= nowMs()) return { ok: false, code: 'expired', claims };
    return { ok: true, claims: claims as GateClaims };
  }

  return {
    hash: hashGateCredential,
    sign,
    verify
  };
}

export { CREDENTIAL_PREFIX, createGateCredentialSigner, hashGateCredential };
