// Internal credential proof; never part of a wire response.
export type CredentialProof = { userId: string; passwordHash: string };
export type SessionRefusal =
  | { status: 'invalid_credentials' }
  | { status: 'blocked'; blockedUntil: number | null; blockReason: string }
  | { status: 'deletion_pending'; deletionRequestedAt: number };
export class SessionIssuanceError extends Error {
  readonly refusal: SessionRefusal;
  constructor(refusal: SessionRefusal) {
    super('Session issuance refused');
    this.name = 'SessionIssuanceError';
    this.refusal = refusal;
  }
}
