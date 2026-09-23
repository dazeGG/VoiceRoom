// Branch-by-branch proofs for LiveKit media admission (domains/admission).
// Every refusal the client can see, every credential that must be revoked on
// the way out, and the LiveKit admin calls behind kick, ban and server mute.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createAdmissionService, revokeIssuedAdmission } from '../src/domains/admission/admission.service.ts';
import { createLiveKitAdmin, isLiveKitParticipantAlreadyGone, resolveServerMutePermission } from '../src/domains/admission/livekit-admin.ts';
import { liveKitHttpUrl, readLiveKitConfig } from '../src/domains/admission/livekit-config.ts';
import { tokensMatch } from '../src/platform/crypto/tokens-match.ts';

const ENABLED = { adminUrl: 'http://livekit:7880', apiKey: 'k', apiSecret: 's', enabled: true, gateSecret: 'x'.repeat(32), gateUrl: 'wss://gate', url: 'ws://livekit:7880' };
const PRINCIPAL = { principalType: 'guest', principalId: 'room-1:guest-1' };

function quietLog() {
  const entries = { warn: [], error: [] };
  return { entries, log: { warn: (fields) => entries.warn.push(fields), error: (fields) => entries.error.push(fields) } };
}

function setup(overrides = {}) {
  const calls = { issued: [], revokedCredentials: [], revokedPrincipals: [], persisted: [], failures: 0 };
  let muted = false;
  const deps = {
    livekitConfig: () => ENABLED,
    credentialProvider: () => ({
      async issueAdmission(input) {
        calls.issued.push(input);
        return { status: 'issued', admission: { gateCredentialId: `cred-${calls.issued.length}`, room: input.livekitRoom, token: 'jwt', ttlSeconds: 600, url: 'wss://gate/?c' } };
      }
    }),
    credentialBoundary: () => ({
      async revokeCredential(input) { calls.revokedCredentials.push(input.credentialId); return { status: 'revoked' }; },
      async revokePrincipal(input) { calls.revokedPrincipals.push(input); }
    }),
    store: () => ({
      async getOrCreatePeerIdentity() { return { status: 'created', identity: { id: 'guest-1' } }; },
      normalizeGatePrincipal: () => PRINCIPAL,
      async isRoomServerMuted() { return muted; }
    }),
    roomExists: async () => true,
    findRoomBan: async () => null,
    waitForRosterPeer: async () => ({ sessionToken: 'token-token-token' }),
    memberships: () => ({ service: { async persistSuccessfulAdmission(input) { calls.persisted.push(input); return { status: 'active' }; } } }),
    roomName: (roomId) => `voice-room-${roomId}`,
    recordRevokeFailure: () => { calls.failures += 1; },
    ...overrides
  };
  return { calls, deps, setMuted: (value) => { muted = value; }, service: createAdmissionService(deps) };
}

function request(extra = {}) {
  return { roomId: 'room-1', peerId: 'peer-1', sessionToken: 'token-token-token', name: 'Guest', user: null, clientIp: '203.0.113.1', log: quietLog().log, ...extra };
}

test('a roster peer with a matching token is admitted with the microphone', async () => {
  const { service, calls } = setup();
  const result = await service.admit(request());
  assert.equal(result.status, 'issued');
  assert.equal(result.admission.token, 'jwt');
  assert.equal(calls.issued[0].canPublishMicrophone, true);
  assert.equal(calls.issued[0].livekitRoom, 'voice-room-room-1');
  assert.deepEqual(calls.revokedCredentials, []);
});

test('refusals before anything is issued', async () => {
  const cases = [
    [{ roomExists: async () => false }, 'room_not_found'],
    [{ findRoomBan: async () => ({ id: 'ban' }) }, 'room_banned'],
    [{ waitForRosterPeer: async () => null }, 'not_in_room'],
    [{ waitForRosterPeer: async () => ({ sessionToken: 'someone-else-token' }) }, 'invalid_session'],
    [{ credentialProvider: () => null, livekitConfig: () => ({ ...ENABLED, enabled: false }) }, 'livekit_unconfigured'],
    [{ credentialProvider: () => null, livekitConfig: () => ({ ...ENABLED, gateSecret: 'short' }) }, 'livekit_gate_unconfigured'],
    [{ credentialProvider: () => null }, 'livekit_gate_unavailable']
  ];
  for (const [overrides, reason] of cases) {
    const { service, calls } = setup(overrides);
    assert.deepEqual(await service.admit(request()), { status: 'refused', reason }, reason);
    assert.equal(calls.issued.length, 0, reason);
  }
});

test('identity, principal and moderation state must all be available', async () => {
  const base = setup();
  const store = base.deps.store();
  const cases = [
    [{ store: () => ({ ...store, async getOrCreatePeerIdentity() { return { status: 'token_mismatch' }; } }) }, 'invalid_session'],
    [{ store: () => ({ ...store, normalizeGatePrincipal: () => null }) }, 'livekit_gate_principal_unavailable'],
    [{ store: () => ({ ...store, async isRoomServerMuted() { throw new Error('db down'); } }) }, 'server_mute_unavailable'],
    [{ store: () => ({ ...store, isRoomServerMuted: undefined }) }, 'server_mute_unavailable']
  ];
  for (const [overrides, reason] of cases) {
    const { service } = setup(overrides);
    assert.deepEqual(await service.admit(request()), { status: 'refused', reason }, reason);
  }
  const accounts = setup({ memberships: () => null });
  assert.deepEqual(await accounts.service.admit(request({ user: { id: 'user-1' } })), { status: 'refused', reason: 'membership_unavailable' });
});

test('a failed issue is refused and logged', async () => {
  const { entries, log } = quietLog();
  const { service } = setup({ credentialProvider: () => ({ issueAdmission: async () => ({ status: 'unavailable', admission: null }) }) });
  assert.deepEqual(await service.admit(request({ log })), { status: 'refused', reason: 'livekit_gate_credential_unavailable' });
  assert.equal(entries.warn[0].code, 'livekit_gate_credential_unavailable');
});

test('a server mute that lands during issue revokes and reissues without the microphone', async () => {
  const { service, calls, deps } = setup();
  let lookups = 0;
  const store = deps.store();
  deps.store = () => ({ ...store, async isRoomServerMuted() { lookups += 1; return lookups > 1; } });
  const result = await service.admit(request());
  assert.equal(result.status, 'issued');
  assert.deepEqual(calls.revokedCredentials, ['cred-1']);
  assert.equal(calls.issued[1].canPublishMicrophone, false);
  assert.equal(result.admission.gateCredentialId, 'cred-2');
});

test('a reissue after a mute race can still fail', async () => {
  let issues = 0;
  let lookups = 0;
  const { service, deps } = setup({
    credentialProvider: () => ({
      async issueAdmission() {
        issues += 1;
        return issues === 1 ? { status: 'issued', admission: { gateCredentialId: 'cred-1' } } : { status: 'unavailable', admission: null };
      }
    })
  });
  const store = deps.store();
  deps.store = () => ({ ...store, async isRoomServerMuted() { lookups += 1; return lookups > 1; } });
  assert.deepEqual(await service.admit(request()), { status: 'refused', reason: 'livekit_gate_credential_unavailable' });
});

test('a failing mute re-check revokes the issued credential and rethrows', async () => {
  let lookups = 0;
  const { service, calls, deps } = setup();
  const store = deps.store();
  deps.store = () => ({ ...store, async isRoomServerMuted() { lookups += 1; if (lookups > 1) throw new Error('lost'); return false; } });
  await assert.rejects(service.admit(request()), /lost/);
  assert.deepEqual(calls.revokedCredentials, ['cred-1']);
});

test('a ban that lands during admission revokes the principal', async () => {
  let checks = 0;
  const { service, calls } = setup({ findRoomBan: async () => (++checks > 1 ? { id: 'ban' } : null) });
  assert.deepEqual(await service.admit(request()), { status: 'refused', reason: 'room_banned' });
  assert.deepEqual(calls.revokedPrincipals, [{ roomId: 'room-1', principal: PRINCIPAL }]);
  const noBoundary = setup({ findRoomBan: async () => (++checks > 3 ? { id: 'ban' } : null), credentialBoundary: () => null });
  assert.deepEqual(await noBoundary.service.admit(request()), { status: 'refused', reason: 'room_banned' });
});

test('account admissions persist membership and revoke the credential when that fails', async () => {
  const user = { id: 'user-1', avatarColorKey: 'green' };
  const ok = setup();
  assert.equal((await ok.service.admit(request({ user }))).status, 'issued');
  assert.deepEqual(ok.calls.persisted, [{ roomId: 'room-1', userId: 'user-1', ip: '203.0.113.1', admissionSucceeded: true }]);

  for (const [status, reason] of [['banned', 'room_banned'], ['conflict', 'membership_persist_failed']]) {
    const refused = setup({ memberships: () => ({ service: { persistSuccessfulAdmission: async () => ({ status }) } }) });
    assert.deepEqual(await refused.service.admit(request({ user })), { status: 'refused', reason });
    assert.deepEqual(refused.calls.revokedCredentials, ['cred-1']);
  }

  const thrown = setup({ memberships: () => ({ service: { persistSuccessfulAdmission: async () => { throw new Error('db down'); } } }) });
  await assert.rejects(thrown.service.admit(request({ user })), /db down/);
  assert.deepEqual(thrown.calls.revokedCredentials, ['cred-1']);
});

test('credential cleanup failures are metered and never hide the primary failure', async () => {
  const primary = new Error('primary');
  let failures = 0;
  const { entries, log } = quietLog();
  const refuse = { async revokeCredential() { return { status: 'not_found' }; } };
  await assert.rejects(
    revokeIssuedAdmission({ boundary: refuse, cause: primary, credentialId: 'c', principal: PRINCIPAL, recordFailure: () => { failures += 1; }, log, roomId: 'r' }),
    (error) => error instanceof AggregateError && error.errors[0] === primary && error.errors[1].code === 'credential_revoke_cleanup_refused'
  );
  await assert.rejects(
    revokeIssuedAdmission({ boundary: null, credentialId: 'c', principal: PRINCIPAL, recordFailure: () => { failures += 1; }, log: undefined, roomId: 'r' }),
    /cleanup was refused/
  );
  assert.equal(failures, 2);
  assert.equal(entries.error[0].code, 'credential_revoke_cleanup_failed');
});

test('a server mute revokes the principal and survives a failing revocation', async () => {
  const ok = setup();
  const { log, entries } = quietLog();
  await ok.service.revokeForServerMute({ roomId: 'room-1', peerId: 'peer-1', principal: PRINCIPAL, log });
  assert.equal(ok.calls.revokedPrincipals.length, 1);

  const failing = setup({ credentialBoundary: () => ({ async revokePrincipal() { throw new Error('db down'); } }) });
  await failing.service.revokeForServerMute({ roomId: 'room-1', peerId: 'peer-1', principal: PRINCIPAL, log });
  assert.equal(failing.calls.failures, 1);
  assert.equal(entries.error[0].evt, 'livekit.mute_failed');

  const none = setup({ credentialBoundary: () => null });
  await none.service.revokeForServerMute({ roomId: 'room-1', peerId: 'peer-1', principal: PRINCIPAL, log });
});

test('LiveKit configuration needs credentials, both URLs and a gate in front of the SFU', () => {
  const env = { LIVEKIT_INTERNAL_URL: 'ws://livekit:7880', LIVEKIT_API_KEY: ' k ', LIVEKIT_API_SECRET: ' s ' };
  const config = readLiveKitConfig(env, { gatePublicUrl: 'wss://gate.example', gateSecret: 'x'.repeat(32) });
  assert.deepEqual(config, { adminUrl: 'http://livekit:7880', apiKey: 'k', apiSecret: 's', enabled: true, gateSecret: 'x'.repeat(32), gateUrl: 'wss://gate.example', url: 'ws://livekit:7880' });
  assert.equal(readLiveKitConfig({ LIVEKIT_URL: 'ws://livekit:7880', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's' }, { gatePublicUrl: '', gateSecret: '' }).enabled, false, 'browsers must not reach the SFU directly');
  assert.equal(readLiveKitConfig({}, { gatePublicUrl: '', gateSecret: '' }).enabled, false);
  assert.equal(liveKitHttpUrl('wss://a'), 'https://a');
  assert.equal(liveKitHttpUrl(''), '');
});

test('LiveKit admin removes participants and treats "already gone" as success', async () => {
  const errors = [];
  const removed = [];
  let failWith = null;
  const client = { async removeParticipant(room, id) { if (failWith) throw failWith; removed.push([room, id]); } };
  const admin = createLiveKitAdmin({ config: () => ENABLED, roomName: (id) => `vr-${id}`, logger: () => ({ error: (fields) => errors.push(fields) }), clientFactory: () => client });
  await admin.removeParticipant('room-1', 'peer-1');
  assert.deepEqual(removed, [['vr-room-1', 'peer-1']]);
  failWith = Object.assign(new Error('twirp error unknown: participant does not exist'), { status: 404 });
  await admin.removeParticipant('room-1', 'peer-1');
  assert.equal(errors.length, 0);
  failWith = new Error('boom');
  await admin.removeParticipant('room-1', 'peer-1');
  assert.equal(errors[0].evt, 'livekit.participant_remove_failed');

  const disabled = createLiveKitAdmin({ config: () => ({ ...ENABLED, enabled: false }), roomName: String, logger: () => ({ error() {} }), clientFactory: () => { throw new Error('must not connect'); } });
  await disabled.removeParticipant('room-1', 'peer-1');
  assert.equal(await disabled.setParticipantMuted('room-1', 'peer-1', true), undefined);
});

test('LiveKit admin server mute narrows the grant, mutes the mic and falls back to a disconnect', async () => {
  const calls = [];
  const participant = { permission: { canSubscribe: true, canPublishSources: [2, 3, 4] }, tracks: [{ source: 2, muted: false, sid: 'mic' }, { source: 4, muted: false, sid: 'screen-audio' }] };
  let getError = null;
  let removeError = null;
  const client = {
    async getParticipant() { if (getError) throw getError; return participant; },
    async updateParticipant(room, id, metadata, permission) { calls.push(['update', permission.canPublishSources]); },
    async mutePublishedTrack(room, id, sid) { calls.push(['mute', sid]); },
    async removeParticipant() { if (removeError) throw removeError; calls.push(['remove']); }
  };
  const errors = [];
  const admin = createLiveKitAdmin({ config: () => ENABLED, roomName: String, logger: () => ({ error: (fields) => errors.push(fields) }), clientFactory: () => client });

  assert.deepEqual(await admin.setParticipantMuted('room-1', 'peer-1', true), { status: 'applied' });
  // TrackSource: 2 microphone, 3 screen share, 4 screen share audio.
  assert.deepEqual(calls, [['update', [3, 4]], ['mute', 'mic']]);
  calls.length = 0;
  assert.deepEqual(await admin.setParticipantMuted('room-1', 'peer-1', false), { status: 'applied' });
  assert.deepEqual(calls, [['update', [2, 3, 4]]], 'unmuting keeps the declared sources and the microphone');

  getError = { status: 404 };
  assert.deepEqual(await admin.setParticipantMuted('room-1', 'peer-1', true), { status: 'offline' });
  getError = new Error('sfu down');
  calls.length = 0;
  assert.deepEqual(await admin.setParticipantMuted('room-1', 'peer-1', true), { status: 'disconnected' });
  assert.deepEqual(calls, [['remove']]);
  await assert.rejects(admin.setParticipantMuted('room-1', 'peer-1', false), /sfu down/);
  removeError = new Error('remove failed');
  await assert.rejects(admin.setParticipantMuted('room-1', 'peer-1', true), (error) => error instanceof AggregateError);
  assert.equal(errors[0].evt, 'livekit.mute_failed');
});

test('mute permissions and "already gone" classification', () => {
  assert.deepEqual(resolveServerMutePermission(undefined, true).canPublishSources, [3, 4]);
  assert.deepEqual(resolveServerMutePermission({ canPublishSources: [] }, false).canPublishSources.sort(), [2, 3, 4]);
  assert.equal(isLiveKitParticipantAlreadyGone({ code: 'NOT_FOUND' }), true);
  assert.equal(isLiveKitParticipantAlreadyGone(null), false);
  assert.equal(tokensMatch('abc', 'abc'), true);
  assert.equal(tokensMatch('abc', 'abd'), false);
  assert.equal(tokensMatch('', ''), false);
  assert.equal(tokensMatch('abc', 'abcd'), false);
});
