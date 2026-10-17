// LiveKit calls the published microphone silent whenever the gate is closed,
// so the "microphone sends no sound" toast must hear the raw capture first.

import { expect, test } from 'vitest';
import { flushMicrotasks, loadLiveKitHarness } from '../helpers/livekit-harness.ts';

async function joinWithMicrophone(inputSilent: boolean) {
  const lk = await loadLiveKitHarness({
    autoResolveClient: true,
    requestToken: async () => ({ token: 't', url: 'wss://lk.example' }),
    inputSilent: async () => inputSilent
  });
  const rawTrack = { kind: 'audio' };
  Object.assign(lk.state, {
    joined: true,
    muted: false,
    roomId: 'room-a',
    peerId: 'peer-1',
    sessionToken: 'session-1',
    localStream: null,
    localRawStream: { getAudioTracks: () => [rawTrack] }
  });
  await lk.service.connectLiveKitRoom('room-a');
  const fireSilence = async () => {
    for (const handler of lk.rooms[0]?.listeners.get('LocalAudioSilenceDetected') ?? []) handler();
    await flushMicrotasks();
  };
  return { lk, fireSilence };
}

test('a closed gate on a working microphone shows no toast', async () => {
  const { lk, fireSilence } = await joinWithMicrophone(false);
  await fireSilence();
  expect(lk.toasts).toEqual([]);
});

test('a microphone that delivers nothing before processing is reported', async () => {
  const { lk, fireSilence } = await joinWithMicrophone(true);
  await fireSilence();
  expect(lk.toasts).toEqual(['Микрофон не передает звук']);
});

test('a muted user is not told that the microphone is silent', async () => {
  const { lk, fireSilence } = await joinWithMicrophone(true);
  lk.state.muted = true;
  await fireSilence();
  expect(lk.toasts).toEqual([]);
});
