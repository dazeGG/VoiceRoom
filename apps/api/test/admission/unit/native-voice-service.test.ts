import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  NativeVoiceAdmissionBody,
  NativeVoicePreference,
  NativeVoiceStage
} from '@voiceroom/shared/contracts/admission';
import { nativeVoiceIdentity } from '@voiceroom/shared/validation';
import type { AdmissionIssue } from '../../../src/domains/admission/livekit-credential-provider.ts';
import type {
  NativeVoiceLease,
  NativeVoiceRepository
} from '../../../src/domains/admission/native-voice.repository.ts';
import { createNativeVoiceService } from '../../../src/domains/admission/native-voice.service.ts';
import { readNativeVoicePolicy } from '../../../src/app/config.ts';
import { fake, recordingLogger } from '../../fakes/index.ts';

const body: NativeVoiceAdmissionBody = {
  version: 1,
  roomId: 'room',
  peerId: 'native-peer',
  sessionToken: 's'.repeat(32),
  generation: 'a'.repeat(32)
};
const auth = { accountId: 'account', authSessionHash: 'hash', ip: '127.0.0.1' };

for (const [failure, expected, reserves, issues] of [
  ['already banned', 'banned', 0, 0],
  ['provider missing', 'unavailable', 0, 0],
  ['stale after reservation', 'stale', 1, 0],
  ['issuer refuses', 'unavailable', 1, 1],
  ['banned during issuance', 'banned', 1, 1]
] as const) {
  test(`native voice refuses admission when ${failure} and retires any reserved slot`, async () => {
    let currentGeneration = body.generation;
    let banned = failure === 'already banned';
    let issueCalls = 0;
    const reserved: Array<Parameters<NativeVoiceRepository['reserve']>[0]> = [];
    const retired: NativeVoiceLease[] = [];
    const removed: Array<[string, string]> = [];
    const repository = fake<NativeVoiceRepository>({
      async reserve(lease) {
        reserved.push(lease);
        if (failure === 'stale after reservation') currentGeneration = 'b'.repeat(32);
        return true;
      },
      async retire(lease) {
        retired.push(lease);
        return true;
      },
      async list() {
        return [];
      }
    });
    const service = createNativeVoiceService({
      policy: () => ({ stage: 'internal-join', accounts: new Set([auth.accountId]), cap: 1, defaultPercent: 0 }),
      repository: () => repository,
      provider: () =>
        failure === 'provider missing'
          ? null
          : {
              refreshCompanionToken: async () => null,
              async issueAdmission(): Promise<AdmissionIssue> {
                issueCalls += 1;
                if (failure === 'issuer refuses') return { status: 'unavailable', admission: null };
                banned = true;
                return {
                  status: 'issued',
                  admission: {
                    gateCredentialId: 'credential',
                    room: 'vr-room',
                    token: 'token',
                    ttlSeconds: 60,
                    url: 'wss://gate'
                  }
                };
              }
            },
      rosterPeer: () => ({
        accountUserId: auth.accountId,
        authSessionHash: auth.authSessionHash,
        desktop: true,
        gateGuestPrincipalId: '',
        sessionToken: body.sessionToken,
        transportId: currentGeneration
      }),
      mainRoom: async () => true,
      banned: async () => banned,
      roomName: (room) => `vr-${room}`,
      async removeParticipant(room, identity) {
        removed.push([room, identity]);
      },
      publish: () => assert.fail('A refused companion must never be published'),
      logger: recordingLogger,
      recordFailure: () => assert.fail('Retirement must succeed')
    });
    assert.deepEqual(service.capability(body.roomId, body.peerId), {
      version: 1,
      stage: 'internal-join',
      defaultEnabled: false,
      generation: body.generation
    });
    assert.deepEqual(await service.admit(body, auth), { status: expected });
    await service.stop();
    assert.equal(reserved.length, reserves);
    assert.equal(issueCalls, issues);
    assert.deepEqual(
      retired.map((lease) => lease.id),
      reserved.map((lease) => lease.id)
    );
    assert.deepEqual(
      removed,
      reserved.map((lease) => [body.roomId, nativeVoiceIdentity(body.peerId, lease.id)])
    );
  });
}

test('native voice stage, allowlist, preference and percent agree at capability and admission', async () => {
  let stage: NativeVoiceStage = 'off';
  let allowlisted = false;
  let preference: NativeVoicePreference = 'default';
  let defaultPercent = 0;
  let account: string | null = auth.accountId;
  let cap = 1;
  const service = createNativeVoiceService({
    policy: () => ({ stage, cap, accounts: new Set(allowlisted ? [auth.accountId] : []), defaultPercent }),
    repository: () => null,
    provider: () => null,
    rosterPeer: () => ({
      accountUserId: account,
      authSessionHash: auth.authSessionHash,
      desktop: true,
      nativeVoiceReceive: true,
      nativeVoicePreference: preference,
      gateGuestPrincipalId: '',
      sessionToken: body.sessionToken,
      transportId: body.generation
    }),
    mainRoom: async () => true,
    banned: async () => false,
    roomName: (room) => room,
    removeParticipant: async () => {},
    publish: () => {},
    logger: recordingLogger,
    recordFailure: () => {}
  });
  for (const mode of ['off', 'internal-join', 'receive'] as const) {
    stage = mode;
    for (const listed of [false, true]) {
      allowlisted = listed;
      for (const choice of ['default', 'on', 'off'] as const) {
        preference = choice;
        for (const percent of [0, 100]) {
          defaultPercent = percent;
          const eligible =
            mode !== 'off' &&
            (listed || (mode === 'receive' && (choice === 'on' || (choice === 'default' && percent === 100))));
          assert.equal(service.capability(body.roomId, body.peerId)?.stage, eligible ? mode : 'off');
          const defaultEnabled = mode === 'receive' && (listed || percent === 100);
          assert.deepEqual(service.accountCapability(auth.accountId), { defaultEnabled });
          assert.equal(service.capability(body.roomId, body.peerId)?.defaultEnabled, defaultEnabled);
          assert.equal(
            (await service.admit(body, auth)).status,
            eligible ? 'unavailable' : mode === 'off' ? 'off' : 'ineligible'
          );
        }
      }
    }
  }

  allowlisted = false;
  preference = 'default';
  // SHA-256("account") places it in bucket 78.
  defaultPercent = 78;
  assert.equal(service.capability(body.roomId, body.peerId)?.stage, 'off');
  assert.equal(service.accountCapability(auth.accountId).defaultEnabled, false);
  defaultPercent = 79;
  assert.equal(service.capability(body.roomId, body.peerId)?.stage, 'receive');
  assert.equal(service.accountCapability(auth.accountId).defaultEnabled, true);
  account = null;
  assert.equal(service.capability(body.roomId, body.peerId), undefined);
  assert.equal((await service.admit(body, auth)).status, 'ineligible');
  account = auth.accountId;
  cap = 0;
  assert.equal(service.capability(body.roomId, body.peerId)?.stage, 'off');
  assert.equal(service.accountCapability(auth.accountId).defaultEnabled, false);
});

test('renewal rechecks the roster around the durable write and retires a lease that lost its seat', async () => {
  let generation = body.generation;
  let banned = false;
  let roomExists = true;
  let tokenAvailable = true;
  let providerAvailable = true;
  const writeStarted = Promise.withResolvers<void>();
  const permitWrite = Promise.withResolvers<void>();
  const retired = Promise.withResolvers<string>();
  const repo = fake<NativeVoiceRepository>({
    reserve: async () => true,
    activate: async () => {},
    async renew(_id, expiresAt) {
      writeStarted.resolve();
      await permitWrite.promise;
      return expiresAt;
    },
    async retire(lease) {
      retired.resolve(lease.id);
      return true;
    }
  });
  const service = createNativeVoiceService({
    policy: () => ({ stage: 'receive', accounts: new Set([auth.accountId]), cap: 1, defaultPercent: 0 }),
    repository: () => repo,
    provider: () =>
      providerAvailable
        ? {
            issueAdmission: async () => ({
              status: 'issued',
              admission: {
                gateCredentialId: 'gate',
                room: 'vr-room',
                token: 'initial',
                ttlSeconds: 600,
                url: 'wss://gate'
              }
            }),
            refreshCompanionToken: async () => (tokenAvailable ? 'refreshed' : null)
          }
        : null,
    rosterPeer: () => ({
      accountUserId: auth.accountId,
      authSessionHash: auth.authSessionHash,
      desktop: true,
      gateGuestPrincipalId: '',
      sessionToken: body.sessionToken,
      transportId: generation
    }),
    mainRoom: async () => roomExists,
    banned: async () => banned,
    roomName: (room) => room,
    removeParticipant: async () => {},
    publish: () => {},
    logger: recordingLogger,
    recordFailure: () => assert.fail('Retirement must succeed')
  });
  const issued = await service.admit(body, auth);
  assert.equal(issued.status, 'issued');
  const { leaseId } = issued.admission;
  assert.ok(leaseId);
  const renewal = { ...body, leaseId };

  roomExists = false;
  assert.deepEqual(await service.renew(renewal, auth), { status: 'wrong_room' });
  roomExists = true;
  banned = true;
  assert.deepEqual(await service.renew(renewal, auth), { status: 'banned' });
  banned = false;
  providerAvailable = false;
  assert.deepEqual(await service.renew(renewal, auth), { status: 'unavailable' });
  providerAvailable = true;
  tokenAvailable = false;
  assert.deepEqual(await service.renew(renewal, auth), { status: 'unavailable' });
  tokenAvailable = true;

  const pending = service.renew(renewal, auth);
  await writeStarted.promise;
  generation = 'b'.repeat(32);
  permitWrite.resolve();
  assert.deepEqual(await pending, { status: 'stale' });
  assert.equal(await retired.promise, leaseId);
  assert.deepEqual(service.mapping(body.roomId).companions, []);
});

test('native voice rollout percent defaults to zero and accepts only integers from 0 through 100', () => {
  assert.equal(readNativeVoicePolicy({}, 12).defaultPercent, 0);
  for (const percent of [0, 50, 100]) {
    assert.equal(readNativeVoicePolicy({ NATIVE_VOICE_DEFAULT_PERCENT: String(percent) }, 12).defaultPercent, percent);
  }
  for (const invalid of ['-1', '101', '10.5', 'typo']) {
    assert.throws(
      () => readNativeVoicePolicy({ NATIVE_VOICE_DEFAULT_PERCENT: invalid }, 12),
      /NATIVE_VOICE_DEFAULT_PERCENT/
    );
  }
});
