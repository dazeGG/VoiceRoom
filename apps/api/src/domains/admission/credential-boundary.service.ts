import crypto from 'node:crypto';
import { isLiveKitOnlyIdentity, nativeVoiceIdentity } from '@voiceroom/shared/validation';
import type { GatePrincipal } from './gate-principal.ts';
import { createGateCredentialSigner, type GateClaims, type GateCredentialSigner } from './gate-credential-signer.ts';
import type { GateCredentialRepository } from './gate-credential.repository.ts';

const DEFAULT_CREDENTIAL_TTL_MS = 6 * 60 * 60 * 1000;

// The gate credential calls of the room store the boundary works through.
export type GateRoomStore = Pick<
  GateCredentialRepository,
  | 'assertLiveKitGateReady'
  | 'createLiveKitGateCredential'
  | 'getLiveKitGatePrincipalEpoch'
  | 'normalizeGatePrincipal'
  | 'revokeLiveKitGateCredential'
  | 'revokeLiveKitGatePeer'
  | 'revokeLiveKitGatePrincipal'
  | 'verifyLiveKitGateCredential'
>;

export type IssuedCredential = { expiresAt: number; id: string; principalEpoch: number | undefined; value: string };
type StoredCredential = Awaited<ReturnType<GateRoomStore['createLiveKitGateCredential']>>;
export type CredentialIssue =
  | { status: 'issued'; credential: IssuedCredential }
  | { status: Exclude<StoredCredential['status'], 'created'> | 'unavailable'; credential: null };
export type CredentialAuthorization = { ok: true; claims: GateClaims } | { ok: false; code: string };
export type CompanionCredential = { id: string; expiresAt: number; sliding?: boolean };

function createCredentialBoundaryService({
  roomStore,
  secret,
  signer = createGateCredentialSigner({ secret }),
  now = Date.now,
  credentialTtlMs = DEFAULT_CREDENTIAL_TTL_MS
}: {
  roomStore: GateRoomStore;
  secret?: string | undefined;
  signer?: GateCredentialSigner;
  now?: () => number;
  credentialTtlMs?: number;
}) {
  const store = roomStore;
  const clock = now;
  const ttlMs = Math.max(60_000, credentialTtlMs || DEFAULT_CREDENTIAL_TTL_MS);

  function resolvePrincipal({
    roomId,
    accountUserId = null,
    guestPrincipalId = ''
  }: {
    roomId?: string | undefined;
    accountUserId?: string | null;
    guestPrincipalId?: string;
  } = {}): GatePrincipal | null {
    return store.normalizeGatePrincipal({ roomId, accountUserId, guestPrincipalId });
  }

  async function issueCredential({
    roomId,
    peerId,
    principal,
    companion
  }: {
    roomId?: string;
    peerId?: string;
    principal?: GatePrincipal | null;
    companion?: CompanionCredential | undefined;
  } = {}): Promise<CredentialIssue> {
    if (
      !roomId ||
      !peerId ||
      isLiveKitOnlyIdentity(peerId) ||
      !principal ||
      (companion && principal.principalType !== 'account')
    )
      return { status: 'invalid', credential: null };
    const issuedAt = clock();
    const expiresAt = companion?.expiresAt ?? issuedAt + ttlMs;
    if (expiresAt <= issuedAt) return { status: 'invalid', credential: null };
    const epoch = await store.getLiveKitGatePrincipalEpoch({ principal, roomId, now: issuedAt });
    if (epoch.status !== 'ready') return { status: 'unavailable', credential: null };

    const credentialId = companion?.id ?? crypto.randomUUID();
    const value = signer.sign({
      credentialId,
      companion: companion ? true : undefined,
      // A sliding companion keeps the same URL. The credential row and the
      // gate's companion watchdog enforce its current expiry on every use.
      expiresAt: companion?.sliding ? null : expiresAt,
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
      now: issuedAt,
      peerId: companion ? nativeVoiceIdentity(peerId, credentialId) : peerId,
      principal,
      principalEpoch: epoch.epoch,
      roomId
    });
    if (stored.status !== 'created') return { status: stored.status || 'unavailable', credential: null };
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
    if (typeof value !== 'string') return { ok: false, code: 'malformed' };
    const verified = signer.verify(value);
    if (!verified.ok) return { ok: false, code: verified.code };
    const claims = verified.claims;
    if (isLiveKitOnlyIdentity(claims.peer) || (claims.companion && claims.pType !== 'account'))
      return { ok: false, code: 'identity_mismatch' };
    const decision = await store.verifyLiveKitGateCredential({
      credentialHash: signer.hash(value),
      now: clock(),
      peerId: claims.companion ? nativeVoiceIdentity(claims.peer, claims.cid) : claims.peer,
      principalEpoch: claims.pEpoch,
      principalId: claims.pId,
      principalType: claims.pType,
      roomId: claims.room
    });
    return decision.status === 'allowed' ? { ok: true, claims } : { ok: false, code: decision.status || 'denied' };
  }

  async function revokePrincipal({
    roomId,
    principal
  }: { roomId?: string | undefined; principal?: GatePrincipal | null } = {}) {
    if (!roomId || !principal) return { status: 'invalid' as const, epoch: null };
    return store.revokeLiveKitGatePrincipal({ principal, roomId, now: clock() });
  }

  async function revokeCredential({
    credentialId,
    roomId,
    principal
  }: {
    credentialId?: string | undefined;
    roomId?: string | undefined;
    principal?: GatePrincipal | null;
  } = {}) {
    if (!credentialId || !roomId || !principal) return { status: 'invalid' as const };
    return store.revokeLiveKitGateCredential({ credentialId, principal, roomId, now: clock() });
  }

  async function revokePeer({
    roomId,
    accountUserId = null,
    guestPrincipalId = ''
  }: {
    roomId?: string | undefined;
    accountUserId?: string | null;
    guestPrincipalId?: string;
  } = {}) {
    return store.revokeLiveKitGatePeer({ roomId, accountUserId, guestPrincipalId, now: clock() });
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

export { createCredentialBoundaryService };
