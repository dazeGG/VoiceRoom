import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCredentialBoundaryService,
  type GatePrincipal,
  type GateRoomStore
} from '../src/domains/admission/credential-boundary-service.ts';
import type {
  GateClaims,
  GateCredentialSigner,
  GateVerification
} from '../src/domains/admission/gate-credential-signer.ts';
import { fake } from './fakes/index.ts';

const PRINCIPAL: GatePrincipal = { principalId: 'room-1:guest-1', principalType: 'guest' };
const CLAIMS: GateClaims = {
  cid: 'credential',
  exp: 2,
  iat: 1,
  peer: 'peer-1',
  pEpoch: 7,
  pId: PRINCIPAL.principalId,
  pType: PRINCIPAL.principalType,
  room: 'room-1'
};

function createSigner(verifyResult: GateVerification = { ok: true, claims: CLAIMS }): GateCredentialSigner {
  return {
    hash: (value) => `hash:${String(value)}`,
    sign: (claims) => `signed:${String(claims?.credentialId)}`,
    verify: () => verifyResult
  };
}

// A store that implements only what the test drives.
const store = (implementation: Partial<GateRoomStore>) => fake<GateRoomStore>(implementation);

test('credential boundary issues and authorizes a principal-bound credential', async () => {
  const calls: Record<string, unknown> = {};
  const roomStore = store({
    async assertLiveKitGateReady() {
      calls.ready = true;
    },
    async createLiveKitGateCredential(input) {
      calls.create = input;
      return { status: 'created' };
    },
    async getLiveKitGatePrincipalEpoch(input) {
      calls.epoch = input;
      return { status: 'ready', epoch: 7 };
    },
    normalizeGatePrincipal(input) {
      calls.normalize = input;
      return PRINCIPAL;
    },
    async verifyLiveKitGateCredential(input) {
      calls.verify = input;
      return { status: 'allowed' };
    }
  });
  const boundary = createCredentialBoundaryService({
    roomStore,
    signer: createSigner(),
    now: () => 1_000,
    credentialTtlMs: 1
  });

  assert.equal(boundary.resolvePrincipal({ roomId: 'room-1', guestPrincipalId: 'guest-1' }), PRINCIPAL);
  assert.deepEqual(calls.normalize, {
    roomId: 'room-1',
    accountUserId: null,
    guestPrincipalId: 'guest-1'
  });

  const issued = await boundary.issueCredential({
    roomId: 'room-1',
    peerId: 'peer-1',
    principal: PRINCIPAL,
    metadata: { source: 'test' }
  });

  assert.equal(issued.status, 'issued');
  assert.ok(issued.credential);
  assert.equal(issued.credential.expiresAt, 61_000);
  assert.equal(issued.credential.principalEpoch, 7);
  assert.equal(issued.credential.value, `signed:${issued.credential.id}`);
  assert.deepEqual(calls.epoch, { principal: PRINCIPAL, roomId: 'room-1', now: 1_000 });
  assert.deepEqual(calls.create, {
    credentialHash: `hash:${issued.credential.value}`,
    credentialId: issued.credential.id,
    expiresAt: 61_000,
    metadata: { source: 'test' },
    now: 1_000,
    peerId: 'peer-1',
    principal: PRINCIPAL,
    principalEpoch: 7,
    roomId: 'room-1'
  });

  assert.deepEqual(await boundary.authorizeCredential(issued.credential.value), {
    ok: true,
    claims: CLAIMS
  });
  assert.deepEqual(calls.verify, {
    credentialHash: `hash:${issued.credential.value}`,
    now: 1_000,
    peerId: 'peer-1',
    principalEpoch: 7,
    principalId: PRINCIPAL.principalId,
    principalType: PRINCIPAL.principalType,
    roomId: 'room-1'
  });
  assert.equal(await boundary.assertReady(), true);
  assert.equal(calls.ready, true);
});

test('credential boundary fails closed for invalid, unavailable, and denied decisions', async () => {
  const roomStore = store({
    async createLiveKitGateCredential() {
      return { status: 'revoked' };
    },
    async getLiveKitGatePrincipalEpoch() {
      return { status: 'unavailable' } as never;
    },
    async verifyLiveKitGateCredential() {
      return undefined;
    }
  });
  const boundary = createCredentialBoundaryService({ roomStore, signer: createSigner(), now: () => 2_000 });

  assert.deepEqual(await boundary.issueCredential(), { status: 'invalid', credential: null });
  assert.deepEqual(await boundary.issueCredential({ roomId: 'room-1', peerId: 'peer-1', principal: PRINCIPAL }), {
    status: 'unavailable',
    credential: null
  });
  assert.deepEqual(await boundary.authorizeCredential('credential'), { ok: false, code: 'denied' });

  const invalidBoundary = createCredentialBoundaryService({
    roomStore,
    signer: createSigner({ ok: false, code: 'expired', claims: {} })
  });
  assert.deepEqual(await invalidBoundary.authorizeCredential('credential'), { ok: false, code: 'expired' });
  assert.equal(invalidBoundary.resolvePrincipal({ roomId: 'room-1' }), null);
  assert.throws(() => createCredentialBoundaryService({ signer: createSigner() }), /roomStore is required/);
});

test('credential boundary preserves store refusal when credential persistence fails', async () => {
  let storedResult: { status: string } | undefined = { status: 'revoked' };
  const roomStore = store({
    async getLiveKitGatePrincipalEpoch() {
      return { status: 'ready', epoch: 3 };
    },
    async createLiveKitGateCredential() {
      return storedResult;
    }
  });
  const boundary = createCredentialBoundaryService({ roomStore, signer: createSigner() });
  const input = { roomId: 'room-1', peerId: 'peer-1', principal: PRINCIPAL };

  assert.deepEqual(await boundary.issueCredential(input), { status: 'revoked', credential: null });
  storedResult = undefined;
  assert.deepEqual(await boundary.issueCredential(input), { status: 'unavailable', credential: null });
});

test('credential boundary revokes principals through current and legacy stores', async () => {
  const directCalls: unknown[] = [];
  const direct = createCredentialBoundaryService({
    roomStore: store({
      async revokeLiveKitGatePrincipal(input) {
        directCalls.push(input);
        return { status: 'revoked', epoch: 8 };
      }
    }),
    signer: createSigner(),
    now: () => 3_000
  });

  assert.deepEqual(await direct.revokePrincipal({ roomId: 'room-1', principal: PRINCIPAL }), {
    status: 'revoked',
    epoch: 8
  });
  assert.deepEqual(directCalls[0], { principal: PRINCIPAL, roomId: 'room-1', now: 3_000 });
  assert.deepEqual(await direct.revokePrincipal(), { status: 'invalid', epoch: null });

  const legacyCalls: unknown[] = [];
  const legacy = createCredentialBoundaryService({
    roomStore: store({
      async revokeLiveKitGatePeer(input) {
        legacyCalls.push(input);
        return { status: 'revoked', epoch: 9 };
      }
    }),
    signer: createSigner(),
    now: () => 4_000
  });
  await legacy.revokePrincipal({ roomId: 'room-1', principal: PRINCIPAL });
  await legacy.revokePrincipal({
    roomId: 'room-1',
    principal: { principalId: 'user-1', principalType: 'account' }
  });
  await legacy.revokePeer({ roomId: 'room-1', guestPrincipalId: 'guest-2' });

  assert.deepEqual(legacyCalls, [
    { roomId: 'room-1', accountUserId: null, guestPrincipalId: 'guest-1', now: 4_000 },
    { roomId: 'room-1', accountUserId: 'user-1', guestPrincipalId: 'user-1', now: 4_000 },
    { roomId: 'room-1', accountUserId: null, guestPrincipalId: 'guest-2', now: 4_000 }
  ]);
});

test('credential boundary revokes only the requested issued credential', async () => {
  const calls: unknown[] = [];
  const boundary = createCredentialBoundaryService({
    roomStore: store({
      async revokeLiveKitGateCredential(input) {
        calls.push(input);
        return { status: 'revoked' };
      }
    }),
    signer: createSigner(),
    now: () => 4_500
  });
  assert.deepEqual(
    await boundary.revokeCredential({ credentialId: 'credential-1', roomId: 'room-1', principal: PRINCIPAL }),
    { status: 'revoked' }
  );
  assert.deepEqual(calls, [{ credentialId: 'credential-1', principal: PRINCIPAL, roomId: 'room-1', now: 4_500 }]);
  assert.deepEqual(await boundary.revokeCredential(), { status: 'invalid' });
  assert.deepEqual(
    await createCredentialBoundaryService({ roomStore: store({}), signer: createSigner() }).revokeCredential({
      credentialId: 'credential-1',
      roomId: 'room-1',
      principal: PRINCIPAL
    }),
    { status: 'unavailable' }
  );
});

test('credential boundary falls back from peer revocation to normalized principal revocation', async () => {
  const calls: unknown[] = [];
  let normalized: GatePrincipal | null = PRINCIPAL;
  const boundary = createCredentialBoundaryService({
    roomStore: store({
      normalizeGatePrincipal() {
        return normalized;
      },
      async revokeLiveKitGatePrincipal(input) {
        calls.push(input);
        return { status: 'revoked', epoch: 10 };
      }
    }),
    signer: createSigner(),
    now: () => 5_000
  });

  assert.deepEqual(await boundary.revokePeer({ roomId: 'room-1', guestPrincipalId: 'guest-1' }), {
    status: 'revoked',
    epoch: 10
  });
  assert.deepEqual(calls[0], { principal: PRINCIPAL, roomId: 'room-1', now: 5_000 });

  normalized = null;
  assert.deepEqual(await boundary.revokePeer({ roomId: 'room-1' }), { status: 'invalid', epoch: null });

  const unavailable = createCredentialBoundaryService({ roomStore: store({}), signer: createSigner() });
  assert.deepEqual(await unavailable.revokePrincipal({ roomId: 'room-1', principal: PRINCIPAL }), {
    status: 'unavailable',
    epoch: null
  });
});
