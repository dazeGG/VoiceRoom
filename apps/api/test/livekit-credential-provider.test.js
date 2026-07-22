'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createLiveKitCredentialProvider } = require('../src/domains/admission/livekit-credential-provider');

test('livekit credential provider rejects missing admission input without issuing a gate credential', async () => {
  let calls = 0;
  const provider = createLiveKitCredentialProvider({
    apiKey: 'key',
    apiSecret: 'secret',
    boundary: { async issueCredential() { calls += 1; } },
    gateUrl: 'ws://gate.example/rtc'
  });

  assert.deepEqual(await provider.issueAdmission({ roomId: 'room-1' }), { status: 'unavailable', admission: null });
  assert.equal(calls, 0);
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
  assert.equal(new URL(result.admission.url).searchParams.get('vr_gate_credential'), 'signed-gate-value');
  assert.equal(typeof result.admission.token, 'string');
  assert.equal(result.admission.token.split('.').length, 3);
});
