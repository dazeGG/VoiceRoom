import crypto from 'node:crypto';

export type PowChallenge = { challengeId: string; difficulty: number; issuedAt: number; signature: string };
export type PowVerdict =
  | { ok: true }
  | { ok: false; status: 403; error: string; code: 'pow_required' | 'pow_invalid' | 'pow_expired' | 'pow_reused' };

function hasLeadingZeroBits(buffer: Uint8Array, bits: number): boolean {
  const fullBytes = Math.floor(bits / 8);
  const remainingBits = bits % 8;

  for (let index = 0; index < fullBytes; index += 1) {
    if (buffer[index] !== 0) return false;
  }

  if (remainingBits === 0) return true;
  const mask = 0xff << (8 - remainingBits);
  return ((buffer[fullBytes] as number) & mask) === 0;
}

function parsePowChallenge(challenge: unknown): PowChallenge | null {
  if (typeof challenge !== 'string') return null;

  const parts = challenge.split('.');
  if (parts.length !== 4) return null;

  const [challengeId, issuedAtValue, difficultyValue, signature] = parts as [string, string, string, string];
  const issuedAt = Number.parseInt(issuedAtValue, 10);
  const difficulty = Number.parseInt(difficultyValue, 10);
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(challengeId)) return null;
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) return null;
  if (!Number.isFinite(difficulty) || difficulty < 0 || difficulty > 32) return null;
  if (!/^[A-Za-z0-9_-]{32,96}$/.test(signature)) return null;

  return { challengeId, difficulty, issuedAt, signature };
}

function normalizePowNonce(value: unknown): string {
  if (Number.isSafeInteger(value) && (value as number) >= 0) return String(value);
  if (typeof value === 'string' && /^(0|[1-9]\d{0,15})$/.test(value)) return value;
  return '';
}

function timingSafeMatch(expected: string, actual: string): boolean {
  if (!expected || !actual || expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

// Stateful proof-of-work guard for room creation: signs challenges with an HMAC
// keyed by the client IP and tracks spent challenges to prevent replay.
function createProofOfWork({
  secret = crypto.randomBytes(32),
  difficulty,
  ttlMs
}: {
  secret?: crypto.BinaryLike;
  difficulty: number;
  ttlMs: number;
}) {
  const usedChallenges = new Map<string, number>();

  function sign(payload: string, clientIp: string): string {
    return crypto.createHmac('sha256', secret).update(`${clientIp}:${payload}`).digest('base64url');
  }

  function prune(now: number = Date.now()): void {
    for (const [challengeId, expiresAt] of usedChallenges) {
      if (expiresAt <= now) usedChallenges.delete(challengeId);
    }
  }

  function createChallenge(clientIp: string, now: number = Date.now()): string | null {
    if (difficulty <= 0) return null;
    const challengeId = crypto.randomBytes(16).toString('base64url');
    const payload = `${challengeId}.${now}.${difficulty}`;
    return `${payload}.${sign(payload, clientIp)}`;
  }

  function verify(clientIp: string, proof: unknown, now: number = Date.now()): PowVerdict {
    if (difficulty <= 0) return { ok: true };
    prune(now);

    const submitted = proof as { challenge?: unknown; nonce?: unknown } | null | undefined;
    const challenge = typeof submitted?.challenge === 'string' ? submitted.challenge : '';
    const nonce = normalizePowNonce(submitted?.nonce);
    const parsed = parsePowChallenge(challenge);
    if (!parsed || !nonce) {
      return { ok: false, status: 403, error: 'Room creation proof is required', code: 'pow_required' };
    }

    const { challengeId, difficulty: proofDifficulty, issuedAt, signature } = parsed;
    const payload = `${challengeId}.${issuedAt}.${proofDifficulty}`;
    const expectedSignature = sign(payload, clientIp);
    if (proofDifficulty !== difficulty || !timingSafeMatch(expectedSignature, signature)) {
      return { ok: false, status: 403, error: 'Invalid room creation proof', code: 'pow_invalid' };
    }

    if (now < issuedAt || now - issuedAt > ttlMs) {
      return { ok: false, status: 403, error: 'Room creation proof expired', code: 'pow_expired' };
    }

    if (usedChallenges.has(challengeId)) {
      return { ok: false, status: 403, error: 'Room creation proof was already used', code: 'pow_reused' };
    }

    const digest = crypto.createHash('sha256').update(`${challenge}:${nonce}`).digest();
    if (!hasLeadingZeroBits(digest, proofDifficulty)) {
      return { ok: false, status: 403, error: 'Invalid room creation proof', code: 'pow_invalid' };
    }

    usedChallenges.set(challengeId, now + ttlMs);
    return { ok: true };
  }

  return { sign, prune, createChallenge, verify, usedChallenges };
}

export type ProofOfWork = ReturnType<typeof createProofOfWork>;

export { hasLeadingZeroBits, parsePowChallenge, normalizePowNonce, createProofOfWork };
