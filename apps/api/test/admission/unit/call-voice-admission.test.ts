// Call voice admission: a LiveKit credential goes only to the account that holds
// the call seat, and a seat lost while the credential was being issued revokes it.

import test from 'node:test';
import assert from 'node:assert/strict';

import type { AdmissionPeer, CredentialBoundary } from '../../../src/domains/admission/admission.service.ts';
import { createCallVoiceAdmission } from '../../../src/domains/admission/call-voice-admission.service.ts';
import type { GatePrincipal } from '../../../src/domains/admission/gate-principal.ts';
import type { StoredUser } from '../../../src/domains/account/user-records.ts';
import { DomainError } from '../../../src/platform/http/domain-error.ts';

const PRINCIPAL: GatePrincipal = { principalType: 'account', principalId: 'alice' };
const USER: StoredUser = {
  avatarAccent: null,
  avatarColorKey: 'blurple',
  avatarKey: null,
  createdAt: 0,
  displayName: 'Alice',
  doNotDisturb: false,
  id: 'alice',
  login: 'alice',
  passwordHash: '',
  presenceStatus: 'online',
  deletionRequestedAt: null,
  blockedAt: null,
  blockedUntil: null,
  blockReason: '',
  badge: null,
  deletedAt: null,
  desktopAppSeenAt: null,
  appPromptSeenAt: null
};

function seat(accountUserId: string | null, transportId = 't1'): AdmissionPeer {
  return { sessionToken: 's', accountUserId, gateGuestPrincipalId: '', transportId };
}

function setup(overrides: {
  seats?: Array<AdmissionPeer | null>;
  principal?: GatePrincipal | null;
  provider?: boolean;
  issue?: 'issued' | 'unavailable';
  muted?: boolean;
  revoke?: 'revoked' | 'invalid';
}) {
  const seats = overrides.seats ?? [seat('alice')];
  let lookups = 0;
  const calls = {
    issued: new Array<{
      canPublishMicrophone?: boolean;
      call?: true;
      e2ee?: true;
      livekitRoom?: string;
      name?: string;
    }>(),
    revoked: new Array<string | undefined>(),
    failures: 0,
    errors: 0
  };
  const boundary: CredentialBoundary = {
    async revokeCredential({ credentialId }) {
      calls.revoked.push(credentialId);
      return overrides.revoke === 'invalid' ? { status: 'invalid' } : { status: 'revoked' };
    },
    async revokePrincipal() {
      return null;
    }
  };
  const admit = createCallVoiceAdmission({
    currentPeer: () => seats[Math.min(lookups++, seats.length - 1)] ?? null,
    store: () => ({
      normalizeGatePrincipal: () => (overrides.principal === undefined ? PRINCIPAL : overrides.principal),
      isRoomServerMuted: async () => overrides.muted ?? false
    }),
    provider: () =>
      overrides.provider === false
        ? null
        : {
            async issueAdmission(input = {}) {
              calls.issued.push(input);
              return overrides.issue === 'unavailable'
                ? { status: 'unavailable', admission: null }
                : {
                    status: 'issued',
                    admission: {
                      gateCredentialId: 'cred-1',
                      room: input.livekitRoom ?? '',
                      token: 'jwt',
                      ttlSeconds: 600,
                      url: 'wss://gate'
                    }
                  };
            }
          },
    boundary: () => boundary,
    roomName: (roomId) => `vr-${roomId}`,
    logger: {
      error() {
        calls.errors++;
      }
    },
    recordRevokeFailure: () => {
      calls.failures++;
    }
  });
  return { admit: (e2ee = false) => admit('call-room', 'peer-1', USER, { e2ee }), calls };
}

async function refusal(promise: Promise<unknown>): Promise<{ code: string; status: number }> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof DomainError);
    return { code: error.code, status: error.statusCode };
  }
  assert.fail('expected a refusal');
}

test('the seat holder gets a call credential for the call room, muted when the server muted them', async () => {
  const open = setup({});
  assert.equal((await open.admit()).gateCredentialId, 'cred-1');
  assert.deepEqual(
    { ...open.calls.issued[0], principal: undefined, peerId: undefined, roomId: undefined },
    {
      call: true,
      canPublishMicrophone: true,
      livekitRoom: 'vr-call-room',
      name: 'Alice',
      principal: undefined,
      peerId: undefined,
      roomId: undefined
    }
  );

  const muted = setup({ muted: true });
  await muted.admit();
  assert.equal(muted.calls.issued[0]?.canPublishMicrophone, false);
});

test('only a client that declares call E2EE asks for the attribute-updating credential', async () => {
  const encrypted = setup({});
  await encrypted.admit(true);
  assert.equal(encrypted.calls.issued[0]?.e2ee, true);

  const plain = setup({});
  await plain.admit(false);
  assert.equal('e2ee' in (plain.calls.issued[0] ?? {}), false);
});

test('no seat, another account’s seat or a lost seat before issue gets no credential', async () => {
  for (const seats of [[null], [seat('bob')], [seat('alice'), null]]) {
    const { admit, calls } = setup({ seats });
    assert.deepEqual(await refusal(admit()), { code: 'call_not_found', status: 404 });
    assert.equal(calls.issued.length, 0);
  }
});

test('a missing provider, principal or credential is reported as unavailable', async () => {
  for (const options of [{ provider: false }, { principal: null }, { issue: 'unavailable' as const }]) {
    const { admit } = setup(options);
    assert.equal((await refusal(admit())).status, 503);
  }
});

test('a seat replaced while the credential was issued revokes that credential', async () => {
  const replaced = setup({ seats: [seat('alice'), seat('alice'), seat('alice', 't2')] });
  assert.deepEqual(await refusal(replaced.admit()), { code: 'call_not_found', status: 404 });
  assert.deepEqual(replaced.calls.revoked, ['cred-1']);
  assert.equal(replaced.calls.failures, 0);

  const refused = setup({ seats: [seat('alice'), seat('alice'), null], revoke: 'invalid' });
  await assert.rejects(refused.admit(), /cleanup was refused/);
  assert.deepEqual([refused.calls.failures, refused.calls.errors], [1, 1]);
});
