import assert from 'node:assert/strict';
import test from 'node:test';
import type { NativeVoiceAdmissionBody } from '@voiceroom/shared/contracts/admission';
import { nativeVoiceIdentity } from '@voiceroom/shared/validation';
import type { AdmissionIssue } from '../src/domains/admission/livekit-credential-provider.ts';
import type { NativeVoiceLease, NativeVoiceRepository } from '../src/domains/admission/native-voice.repository.ts';
import { createNativeVoiceService } from '../src/domains/admission/native-voice.service.ts';
import { fake, recordingLogger } from './fakes/index.ts';

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
      policy: () => ({ stage: 'internal-join', accounts: new Set([auth.accountId]), cap: 1 }),
      repository: () => repository,
      provider: () =>
        failure === 'provider missing'
          ? null
          : {
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
