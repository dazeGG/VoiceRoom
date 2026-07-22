'use strict';

const crypto = require('node:crypto');
const { createGateCredentialSigner } = require('./gate-credential-signer');

const DEFAULT_CREDENTIAL_TTL_MS = 6 * 60 * 60 * 1000;

function createCredentialBoundaryService({
  roomStore,
  secret,
  signer = createGateCredentialSigner({ secret }),
  now = Date.now,
  credentialTtlMs = DEFAULT_CREDENTIAL_TTL_MS
} = {}) {
  if (!roomStore) throw new TypeError('roomStore is required');
  const clock = typeof now === 'function' ? now : Date.now;
  const ttlMs = Math.max(60_000, Number(credentialTtlMs) || DEFAULT_CREDENTIAL_TTL_MS);

  function resolvePrincipal({ roomId, accountUserId = null, guestPrincipalId = '' } = {}) {
    if (typeof roomStore.normalizeGatePrincipal !== 'function') return null;
    return roomStore.normalizeGatePrincipal({ roomId, accountUserId, guestPrincipalId });
  }

  async function issueCredential({ roomId, peerId, principal, metadata = {} } = {}) {
    if (!roomId || !peerId || !principal) return { status: 'invalid', credential: null };
    const issuedAt = clock();
    const expiresAt = issuedAt + ttlMs;
    const epoch = await roomStore.getLiveKitGatePrincipalEpoch({ principal, roomId, now: issuedAt });
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
    const stored = await roomStore.createLiveKitGateCredential({
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

  async function authorizeCredential(value) {
    const verified = signer.verify(value);
    if (!verified.ok) return { ok: false, code: verified.code };
    const claims = verified.claims;
    const decision = await roomStore.verifyLiveKitGateCredential({
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

  async function revokePrincipal({ roomId, principal } = {}) {
    if (!roomId || !principal) return { status: 'invalid', epoch: null };
    if (typeof roomStore.revokeLiveKitGatePrincipal === 'function') {
      return roomStore.revokeLiveKitGatePrincipal({ principal, roomId, now: clock() });
    }
    if (typeof roomStore.revokeLiveKitGatePeer === 'function') {
      const guestPrefix = `${roomId}:`;
      return roomStore.revokeLiveKitGatePeer({
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

  async function revokePeer({ roomId, accountUserId = null, guestPrincipalId = '' } = {}) {
    if (typeof roomStore.revokeLiveKitGatePeer === 'function') {
      return roomStore.revokeLiveKitGatePeer({ roomId, accountUserId, guestPrincipalId, now: clock() });
    }
    const principal = resolvePrincipal({ roomId, accountUserId, guestPrincipalId });
    if (!principal) return { status: 'invalid', epoch: null };
    return revokePrincipal({ roomId, principal });
  }

  async function assertReady() {
    await roomStore.assertLiveKitGateReady();
    return true;
  }

  return Object.freeze({
    assertReady,
    authorizeCredential,
    issueCredential,
    resolvePrincipal,
    revokePeer,
    revokePrincipal
  });
}

module.exports = { DEFAULT_CREDENTIAL_TTL_MS, createCredentialBoundaryService };
