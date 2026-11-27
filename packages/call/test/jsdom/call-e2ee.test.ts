// A 1:1 call room is end-to-end encrypted: encryption is on before the room connects, the key comes from the
// per-call agreement with the roster's peer, cleartext media is never subscribed, and the microphone sends RED
// only while the peer takes it.

import { expect, test } from 'vitest';
import { CALL_KEY_AGREEMENT_ATTRIBUTE } from '@voiceroom/shared/contracts/rings';
import { startKeyAgreement, type AgreedKey } from '@voiceroom/call/engine/e2ee/key-agreement';
import {
  fakeParticipant,
  fakePublication,
  flushMicrotasks,
  loadLiveKitHarness
} from '../../../../apps/web/test/helpers/livekit-harness.ts';
import { FakeMediaStream, FakeMediaStreamTrack } from '../../../../apps/web/test/helpers/fake-media.ts';

const credentials = { url: 'wss://sfu.example', token: 'jwt' };
const hex = (buffer: ArrayBuffer) => Buffer.from(buffer).toString('hex');

async function until(check: () => boolean, message: string, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function callHarness() {
  const lk = await loadLiveKitHarness({ autoResolveClient: true });
  lk.state.callId = '0c2a5d1e-7b5f-4c71-8f3a-2a7b4f1d9e10';
  lk.state.callE2ee = null;
  const transport = await import('@voiceroom/call/engine/services/livekit/transport');
  const e2ee = await import('@voiceroom/call/engine/e2ee/call-room-e2ee');
  const publications = await import('@voiceroom/call/engine/services/livekit/local-publications');
  return { lk, transport, e2ee, publications };
}

test('a call room turns frame encryption on before it connects, and an ordinary room does not', async () => {
  const { lk, transport } = await callHarness();
  const room = await transport.connectLiveKitWithFallback(credentials, () => true);
  expect(room).toBe(lk.rooms[0]);
  expect(lk.rooms[0]?.roomOptions.encryption).toBeDefined();
  expect(lk.rooms[0]?.lifecycle).toEqual(['e2ee:true', 'connect']);
  expect(lk.workers).toHaveLength(1);

  lk.state.callId = undefined;
  await transport.connectLiveKitWithFallback(credentials, () => true);
  expect(lk.rooms[1]?.roomOptions.encryption).toBeUndefined();
  expect(lk.rooms[1]?.lifecycle).toEqual(['connect']);
  expect(lk.workers).toHaveLength(1);
});

test('a call room candidate that fails to connect stops its encryption worker', async () => {
  const lk = await loadLiveKitHarness({ autoResolveClient: true, failingUrls: [credentials.url] });
  lk.state.callId = '0c2a5d1e-7b5f-4c71-8f3a-2a7b4f1d9e10';
  const transport = await import('@voiceroom/call/engine/services/livekit/transport');
  await expect(transport.connectLiveKitWithFallback(credentials, () => true)).rejects.toThrow();
  expect(lk.workers.length).toBeGreaterThan(0);
  expect(lk.workers.every((worker) => worker.terminated)).toBe(true);
});

test('a call never subscribes to media that is not encrypted, whatever the output wants', async () => {
  const { lk } = await callHarness();
  const clear = fakePublication('microphone', { isEncrypted: false });
  const encrypted = fakePublication('microphone', { isEncrypted: true, trackSid: 'mic-encrypted' });
  const injected = fakeParticipant('peer-x', [clear.publication]);
  const peer = fakeParticipant('peer-a', [encrypted.publication]);
  lk.state.livekitRoom = {
    remoteParticipants: new Map<string, unknown>([
      ['peer-x', injected],
      ['peer-a', peer]
    ])
  };
  lk.syncParticipant(injected);
  lk.syncParticipant(peer);
  lk.service.syncLiveKitVoiceSubscriptions();
  expect(clear.calls.subscribed).not.toContain(true);
  expect(encrypted.calls.subscribed.at(-1)).toBe(true);
});

test('the call agrees its key with the roster peer and installs it; both sides show the same code', async () => {
  const { lk, transport, e2ee } = await callHarness();
  lk.state.callE2eeInitiator = true;
  const room = await transport.connectLiveKitWithFallback(credentials, () => true);
  const fakeRoom = lk.rooms[0];
  if (!room || !fakeRoom) throw new Error('no room');
  const peerAttributes: Record<string, string> = {};
  const peer = fakeParticipant('c-peer', [], { attributes: peerAttributes });
  fakeRoom.remoteParticipants.set('c-peer', peer);
  lk.state.serverPeerIds.add('c-peer');

  // The other side of the call, run by the real agreement module over the fake room's attributes.
  const peerKeys: AgreedKey[] = [];
  const peerListeners = new Set<() => void>();
  fakeRoom.localParticipant.onAttributes = () => setTimeout(() => peerListeners.forEach((listener) => listener()), 1);
  const callee = startKeyAgreement({
    role: 'responder',
    callId: lk.state.callId ?? '',
    red: false,
    channel: {
      async publish(value) {
        peerAttributes[CALL_KEY_AGREEMENT_ATTRIBUTE] = value;
        setTimeout(() => fakeRoom.emit('ParticipantAttributesChanged', {}, peer), 1);
      },
      read: () => fakeRoom.localParticipant.attributes[CALL_KEY_AGREEMENT_ATTRIBUTE],
      subscribe(listener) {
        peerListeners.add(listener);
        return () => peerListeners.delete(listener);
      }
    },
    onKey: (agreed) => peerKeys.push(agreed),
    onFailure: (reason) => {
      throw new Error(`the callee failed: ${reason}`);
    }
  });

  const peerRed: boolean[] = [];
  await e2ee.startCallRoomE2ee(
    room,
    () => true,
    (takesRed) => peerRed.push(takesRed)
  );
  expect(lk.state.callE2ee?.phase).toBe('agreeing');
  await until(() => lk.state.callE2ee?.phase === 'secured', 'the call never secured its key');
  callee.stop();
  e2ee.stopCallRoomE2ee(room);

  const [installed] = lk.callKeys;
  const [agreed] = peerKeys;
  if (!installed || !agreed) throw new Error('no key on one side');
  expect(hex(installed.key)).toBe(hex(agreed.key));
  expect(installed.index).toBe(agreed.index);
  expect(lk.state.callE2ee?.code).toEqual(agreed.code);
  expect(peerRed).toEqual([false]);
  expect(lk.workers[0]?.terminated).toBe(true);
});

test('a participant the roster did not seat cannot take part in the key agreement', async () => {
  const { lk, transport, e2ee } = await callHarness();
  lk.state.callE2eeInitiator = true;
  const room = await transport.connectLiveKitWithFallback(credentials, () => true);
  const fakeRoom = lk.rooms[0];
  if (!room || !fakeRoom) throw new Error('no room');
  const stranger = fakeParticipant('c-stranger', [], {
    attributes: { [CALL_KEY_AGREEMENT_ATTRIBUTE]: JSON.stringify({ v: 1, sid: 'ab'.repeat(16), red: true }) }
  });
  fakeRoom.remoteParticipants.set('c-stranger', stranger);

  await e2ee.startCallRoomE2ee(
    room,
    () => true,
    () => {}
  );
  fakeRoom.emit('ParticipantAttributesChanged', {}, stranger);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await flushMicrotasks();
  // The caller never commits to a stranger: its own state stays the bare presence it published first.
  expect(fakeRoom.localParticipant.attributes[CALL_KEY_AGREEMENT_ATTRIBUTE]).not.toContain('"commit"');
  expect(lk.callKeys).toEqual([]);
  expect(lk.state.callE2ee?.phase).toBe('agreeing');
  e2ee.stopCallRoomE2ee(room);
});

test('the microphone sends RED in a call only while the peer takes it, and always elsewhere', async () => {
  const { lk, publications } = await callHarness();
  const stream = new FakeMediaStream([new FakeMediaStreamTrack('mic', 'audio')]);
  publications.setCallPeerTakesRed(false);
  expect(publications.microphoneSendsRed()).toBe(false);
  publications.setCallPeerTakesRed(true);
  expect(publications.microphoneSendsRed()).toBe(true);

  const transport = await import('@voiceroom/call/engine/services/livekit/transport');
  const connected = await transport.connectLiveKitWithFallback(credentials, () => true);
  if (!connected) throw new Error('no room');
  publications.setCallPeerTakesRed(false);
  const publication = await publications.publishLocalMicrophoneForRoom(connected, stream, () => true);
  expect(lk.rooms[0]?.published.at(-1)?.options.red).toBe(false);
  if (!publication) throw new Error('no publication');
  expect(publications.microphoneRedMismatch(publication)).toBe(false);
  publications.setCallPeerTakesRed(true);
  expect(publications.microphoneRedMismatch(publication)).toBe(true);

  lk.state.callId = undefined;
  publications.setCallPeerTakesRed(null);
  expect(publications.microphoneSendsRed()).toBe(true);
});

test('a call names its peer from the roster only, while other rooms fall back to the roster when LiveKit has no name', async () => {
  const { lk } = await callHarness();
  const remote = await import('@voiceroom/call/engine/services/livekit/remote-participants');
  lk.state.peers.set('c-peer', { id: 'c-peer', name: 'Ада' });

  expect(remote.liveKitParticipantName({ identity: 'c-peer', name: 'Самозванец' })).toBe('Ада');
  expect(remote.liveKitParticipantName({ identity: 'c-other', name: 'Самозванец' })).toBe('c-other');

  lk.state.callId = undefined;
  // Meet gives LiveKit an empty name and keeps the guest name in its roster.
  expect(remote.liveKitParticipantName({ identity: 'c-peer', name: '' })).toBe('Ада');
  expect(remote.liveKitParticipantName({ identity: 'c-peer', name: 'Ada' })).toBe('Ada');
  expect(remote.liveKitParticipantName({ identity: 'c-other', name: '' })).toBe('c-other');
});
