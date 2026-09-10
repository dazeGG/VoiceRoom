'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createLiveKitCredentialProvider } = require('../src/domains/admission/livekit-credential-provider');

function jwtPayload(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

test('livekit credential provider rejects missing admission input without issuing a gate credential', async () => {
  let calls = 0;
  const config = {
    apiKey: 'key',
    apiSecret: 'secret',
    boundary: { async issueCredential() { calls += 1; } },
    gateUrl: 'ws://gate.example/rtc'
  };
  const admission = {
    roomId: 'room-1',
    livekitRoom: 'voice-room-room-1',
    peerId: 'peer-1',
    principal: { principalId: 'guest-1', principalType: 'guest' }
  };

  for (const key of ['apiKey', 'apiSecret', 'gateUrl']) {
    assert.deepEqual(
      await createLiveKitCredentialProvider({ ...config, [key]: '' }).issueAdmission(admission),
      { status: 'unavailable', admission: null }
    );
  }
  for (const key of ['roomId', 'livekitRoom', 'peerId', 'principal']) {
    assert.deepEqual(
      await createLiveKitCredentialProvider(config).issueAdmission({ ...admission, [key]: null }),
      { status: 'unavailable', admission: null }
    );
  }
  assert.equal(calls, 0);
});

test('livekit credential provider requires an issuing boundary', () => {
  assert.throws(() => createLiveKitCredentialProvider(), /credential boundary is required/);
  assert.throws(() => createLiveKitCredentialProvider({ boundary: {} }), /credential boundary is required/);
});

test('livekit credential provider preserves boundary refusal without minting a LiveKit token', async () => {
  const provider = createLiveKitCredentialProvider({
    apiKey: 'key',
    apiSecret: 'secret',
    boundary: { async issueCredential() { return { status: 'revoked' }; } },
    gateUrl: 'ws://gate.example/rtc'
  });

  assert.deepEqual(await provider.issueAdmission({
    roomId: 'room-1',
    livekitRoom: 'voice-room-room-1',
    peerId: 'peer-1',
    principal: { principalId: 'guest-1', principalType: 'guest' }
  }), { status: 'revoked', admission: null });
});

test('livekit credential provider binds the signed gate credential to the public URL', async () => {
  const provider = createLiveKitCredentialProvider({
    apiKey: 'key',
    apiSecret: 'secret',
    boundary: {
      async issueCredential(input) {
        assert.deepEqual(input, {
          roomId: 'room-1',
          peerId: 'peer-1',
          principal: { principalId: 'user-1', principalType: 'account' }
        });
        return { status: 'issued', credential: { id: 'credential-1', value: 'signed-gate-value' } };
      }
    },
    gateUrl: 'wss://gate.example/rtc?region=eu',
    tokenTtlSeconds: 120
  });

  const result = await provider.issueAdmission({
    roomId: 'room-1',
    livekitRoom: 'voice-room-room-1',
    peerId: 'peer-1',
    name: 'Ada',
    principal: { principalId: 'user-1', principalType: 'account' }
  });

  assert.equal(result.status, 'issued');
  assert.equal(result.admission.gateCredentialId, 'credential-1');
  assert.equal(result.admission.room, 'voice-room-room-1');
  assert.equal(result.admission.ttlSeconds, 120);
  assert.equal(new URL(result.admission.url).pathname, '/');
  assert.equal(new URL(result.admission.url).searchParams.get('vr_gate_credential'), 'signed-gate-value');
  assert.equal(typeof result.admission.token, 'string');
  assert.equal(result.admission.token.split('.').length, 3);
});

test('livekit credential provider clamps invalid token TTL to a safe minimum', async () => {
  const provider = createLiveKitCredentialProvider({
    apiKey: 'key',
    apiSecret: 'secret',
    boundary: {
      async issueCredential() {
        return { status: 'issued', credential: { id: 'credential-2', value: 'signed-value-2' } };
      }
    },
    gateUrl: 'wss://gate.example/rtc',
    tokenTtlSeconds: 0
  });

  const result = await provider.issueAdmission({
    roomId: 'room-2',
    livekitRoom: 'voice-room-room-2',
    peerId: 'peer-2',
    principal: { principalId: 'guest-2', principalType: 'guest' }
  });

  assert.equal(result.status, 'issued');
  assert.equal(result.admission.ttlSeconds, 6 * 60 * 60);
});

test('server-muted admission omits microphone publishing while preserving screen sharing', async () => {
  const provider = createLiveKitCredentialProvider({
    apiKey: 'key',
    apiSecret: 'secret',
    boundary: {
      async issueCredential() {
        return { status: 'issued', credential: { id: 'credential-muted', value: 'signed-muted' } };
      }
    },
    gateUrl: 'wss://gate.example/rtc'
  });

  const result = await provider.issueAdmission({
    roomId: 'room-muted',
    livekitRoom: 'voice-room-muted',
    peerId: 'peer-muted',
    principal: { principalId: 'user-muted', principalType: 'account' },
    canPublishMicrophone: false
  });

  const sources = jwtPayload(result.admission.token).video.canPublishSources;
  assert.equal(sources.includes('microphone'), false, 'microphone TrackSource is absent');
  assert.equal(sources.includes('screen_share'), true, 'screen-share TrackSource remains allowed');
  assert.equal(sources.includes('screen_share_audio'), true, 'screen-share audio TrackSource remains allowed');
});
