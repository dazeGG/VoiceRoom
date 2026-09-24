import crypto from 'node:crypto';
import { createGateCredentialSigner, type GateClaims, type GateCredentialSigner } from './gate-credential-signer.ts';

const DEFAULT_CREDENTIAL_TTL_MS = 6 * 60 * 60 * 1000;

export type GatePrincipal = { principalType: 'account' | 'guest'; principalId: string; [key: string]: unknown };
type StoreStatus = { status?: string; [key: string]: unknown } | null | undefined;
export type Revocation = { status: string; epoch?: number | null; revoked?: number | null };

// The subset of the room store the boundary works through. Everything but the
// three issuing/verifying calls is optional: older stores lack the revocations.
export interface GateRoomStore {
  normalizeGatePrincipal?(input: { roomId?: string; accountUserId?: string | null; guestPrincipalId?: string }): GatePrincipal | null;
  getLiveKitGatePrincipalEpoch(input: { principal: GatePrincipal; roomId: string; now: number }): Promise<{ status: 'ready'; epoch: number } | { status: 'invalid'; epoch: null } | null | undefined>;
  createLiveKitGateCredential(input: {
    credentialHash: string;
    credentialId: string;
    expiresAt: number;
    metadata: unknown;
    now: number;
    peerId: string;
    principal: GatePrincipal;
    principalEpoch: number | undefined;
    roomId: string;
  }): Promise<StoreStatus>;
  verifyLiveKitGateCredential(input: {
    credentialHash: string;
    now: number;
    peerId: string;
    principalEpoch: number;
    principalId: string;
    principalType: string;
    roomId: string;
  }): Promise<StoreStatus>;
  revokeLiveKitGatePrincipal?(input: { principal: GatePrincipal; roomId: string; now: number }): Promise<Revocation>;
  revokeLiveKitGatePeer?(input: { roomId?: string; accountUserId?: string | null; guestPrincipalId?: string; now: number }): Promise<Revocation>;
  revokeLiveKitGateCredential?(input: { credentialId: string; principal: GatePrincipal; roomId: string; now: number }): Promise<Revocation>;
  assertLiveKitGateReady(): Promise<unknown>;
}

export type IssuedCredential = { expiresAt: number; id: string; principalEpoch: number | undefined; value: string };
export type CredentialIssue =
  | { status: 'issued'; credential: IssuedCredential }
  | { status: string; credential: null };
export type CredentialAuthorization = { ok: true; claims: GateClaims } | { ok: false; code: string };

function createCredentialBoundaryService({
  roomStore,
  secret,
  signer = createGateCredentialSigner({ secret }),
  now = Date.now,
  credentialTtlMs = DEFAULT_CREDENTIAL_TTL_MS
}: {
  roomStore?: GateRoomStore;
  secret?: unknown;
  signer?: GateCredentialSigner;
  now?: unknown;
  credentialTtlMs?: unknown;
} = {}) {
  if (!roomStore) throw new TypeError('roomStore is required');
  const store = roomStore;
  const clock: () => number = typeof now === 'function' ? now as () => number : Date.now;
  const ttlMs = Math.max(60_000, Number(credentialTtlMs) || DEFAULT_CREDENTIAL_TTL_MS);

  function resolvePrincipal({ roomId, accountUserId = null, guestPrincipalId = '' }: {
    roomId?: string;
    accountUserId?: string | null;
    guestPrincipalId?: string;
  } = {}): GatePrincipal | null {
    if (typeof store.normalizeGatePrincipal !== 'function') return null;
    return store.normalizeGatePrincipal({ roomId, accountUserId, guestPrincipalId });
  }

  async function issueCredential({ roomId, peerId, principal, metadata = {} }: {
    roomId?: string;
    peerId?: string;
    principal?: GatePrincipal | null;
    metadata?: unknown;
  } = {}): Promise<CredentialIssue> {
    if (!roomId || !peerId || !principal) return { status: 'invalid', credential: null };
    const issuedAt = clock();
    const expiresAt = issuedAt + ttlMs;
    const epoch = await store.getLiveKitGatePrincipalEpoch({ principal, roomId, now: issuedAt });
    if (epoch?.status !== 'ready') return { status: 'unavailable', credential: null };

    const credentialId = crypto.randomUUID();
    const value = signer.sign({
      credentialId,
      expiresAt,
      issuedAt,
      peerId,
      principalEpoch: epoch.epoch,
      principalId: principal.principalId,
      principalType: principal.principalType,
      roomId
    });
    const stored = await store.createLiveKitGateCredential({
      credentialHash: signer.hash(value),
      credentialId,
      expiresAt,
      metadata,
      now: issuedAt,
      peerId,
      principal,
      principalEpoch: epoch.epoch,
      roomId
    });
    if (stored?.status !== 'created') return { status: stored?.status || 'unavailable', credential: null };
    return {
      status: 'issued',
      credential: {
        expiresAt,
        id: credentialId,
        principalEpoch: epoch.epoch,
        value
      }
    };
  }

  async function authorizeCredential(value: unknown): Promise<CredentialAuthorization> {
    const verified = signer.verify(value);
    if (!verified.ok) return { ok: false, code: verified.code };
    const claims = verified.claims;
    const decision = await store.verifyLiveKitGateCredential({
      credentialHash: signer.hash(value),
      now: clock(),
      peerId: claims.peer,
      principalEpoch: claims.pEpoch,
      principalId: claims.pId,
      principalType: claims.pType,
      roomId: claims.room
    });
    return decision?.status === 'allowed'
      ? { ok: true, claims }
      : { ok: false, code: decision?.status || 'denied' };
  }

  async function revokePrincipal({ roomId, principal }: { roomId?: string; principal?: GatePrincipal | null } = {}): Promise<Revocation> {
    if (!roomId || !principal) return { status: 'invalid', epoch: null };
    if (typeof store.revokeLiveKitGatePrincipal === 'function') {
      return store.revokeLiveKitGatePrincipal({ principal, roomId, now: clock() });
    }
    if (typeof store.revokeLiveKitGatePeer === 'function') {
      const guestPrefix = `${roomId}:`;
      return store.revokeLiveKitGatePeer({
        roomId,
        accountUserId: principal.principalType === 'account' ? principal.principalId : null,
        guestPrincipalId: principal.principalType === 'guest' && principal.principalId.startsWith(guestPrefix)
          ? principal.principalId.slice(guestPrefix.length)
          : principal.principalId,
        now: clock()
      });
    }
    return { status: 'unavailable', epoch: null };
  }

  async function revokeCredential({ credentialId, roomId, principal }: {
    credentialId?: string;
    roomId?: string;
    principal?: GatePrincipal | null;
  } = {}): Promise<Revocation> {
    if (!credentialId || !roomId || !principal) return { status: 'invalid' };
    if (typeof store.revokeLiveKitGateCredential !== 'function') return { status: 'unavailable' };
    return store.revokeLiveKitGateCredential({ credentialId, principal, roomId, now: clock() });
  }

  async function revokePeer({ roomId, accountUserId = null, guestPrincipalId = '' }: {
    roomId?: string;
    accountUserId?: string | null;
    guestPrincipalId?: string;
  } = {}): Promise<Revocation> {
    if (typeof store.revokeLiveKitGatePeer === 'function') {
      return store.revokeLiveKitGatePeer({ roomId, accountUserId, guestPrincipalId, now: clock() });
    }
    const principal = resolvePrincipal({ roomId, accountUserId, guestPrincipalId });
    if (!principal) return { status: 'invalid', epoch: null };
    return revokePrincipal({ roomId, principal });
  }

  async function assertReady(): Promise<true> {
    await store.assertLiveKitGateReady();
    return true;
  }

  return Object.freeze({
    assertReady,
    authorizeCredential,
    issueCredential,
    resolvePrincipal,
    revokeCredential,
    revokePeer,
    revokePrincipal
  });
}

export type CredentialBoundaryService = ReturnType<typeof createCredentialBoundaryService>;

export { DEFAULT_CREDENTIAL_TTL_MS, createCredentialBoundaryService };
