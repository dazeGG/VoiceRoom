// Cameras in the call: everyone's camera is received at once, at the layer
// its tile needs, and our own camera is captured, published and stopped.

import { afterEach, expect, test, vi } from 'vitest';
import { fakeParticipant, fakePublication, flushMicrotasks, loadLiveKitHarness } from '../helpers/livekit-harness.ts';

const LOW = 0;
const MEDIUM = 1;
const HIGH = 2;

class TestMediaStream {
  constructor(readonly tracks: unknown[]) {}
  getVideoTracks() {
    return this.tracks;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function loadRemoteCamera(peerId = 'peer-a') {
  vi.stubGlobal('MediaStream', TestMediaStream);
  const lk = await loadLiveKitHarness({ autoResolveClient: true });
  const { participantsUi } = await import('../../src/lib/features/room/participants-ui.svelte');
  const { handleLiveKitTrackUnpublished, syncRemoteCameraDemand } =
    await import('../../src/lib/features/room/client/services/livekit/remote-participants.ts');
  const track = { mediaStreamTrack: { kind: 'video', readyState: 'live', id: 'camera-track' } };
  const camera = fakePublication('camera', { isSubscribed: true, track });
  const participant = fakeParticipant(peerId, [camera.publication]);
  lk.state.serverPeerIds.add(peerId);
  return { lk, participantsUi, handleLiveKitTrackUnpublished, syncRemoteCameraDemand, camera, participant, track };
}

test('a remote camera is received at once and its picture reaches the tile', async () => {
  const { lk, camera, participant, track } = await loadRemoteCamera();
  lk.service.syncLiveKitParticipant(participant as never);
  await flushMicrotasks();

  expect(camera.calls.subscribed).toEqual([true]);
  const peer = lk.state.peers.get('peer-a')!;
  expect(peer.camera).toBe(true);
  expect((peer.cameraStream as TestMediaStream).getVideoTracks()).toEqual([track.mediaStreamTrack]);
});

test('the camera layer follows the tile: roomy grid, spotlight, crowded call', async () => {
  const { lk, participantsUi, syncRemoteCameraDemand, camera, participant } = await loadRemoteCamera();
  lk.service.syncLiveKitParticipant(participant as never);
  await flushMicrotasks();
  expect(camera.calls.quality.at(-1)).toBe(MEDIUM);

  participantsUi.focusedParticipantId = 'peer-a';
  syncRemoteCameraDemand();
  await flushMicrotasks();
  expect(camera.calls.quality.at(-1)).toBe(HIGH);

  participantsUi.focusedParticipantId = '';
  for (const id of ['b', 'c', 'd', 'e']) lk.state.peers.set(id, { id });
  syncRemoteCameraDemand();
  await flushMicrotasks();
  expect(camera.calls.quality.at(-1)).toBe(LOW);
});

test('a camera that is turned off leaves the tile', async () => {
  const { lk, handleLiveKitTrackUnpublished, camera, participant } = await loadRemoteCamera();
  lk.service.syncLiveKitParticipant(participant as never);
  await flushMicrotasks();

  participant.trackPublications.delete(camera.publication.trackSid);
  handleLiveKitTrackUnpublished(camera.publication as never, participant as never);
  const peer = lk.state.peers.get('peer-a')!;
  expect(peer.camera).toBe(false);
  expect(peer.cameraStream).toBeNull();
});

function fakeCapture() {
  const ended: Array<() => void> = [];
  const track = {
    kind: 'video',
    readyState: 'live',
    stopped: false,
    stop() {
      this.stopped = true;
    },
    addEventListener: (_event: string, listener: () => void) => ended.push(listener)
  };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  return { stream, track, end: () => ended.forEach((listener) => listener()) };
}

async function loadLocalCamera(getUserMedia: (constraints: MediaStreamConstraints) => Promise<unknown>) {
  const lk = await loadLiveKitHarness({ autoResolveClient: true });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  const published: Array<{ track: unknown; options: Record<string, unknown> }> = [];
  const unpublished: unknown[] = [];
  const room = {
    localParticipant: {
      trackPublications: new Map(),
      publishTrack: async (track: unknown, options: Record<string, unknown>) => {
        published.push({ track, options });
        return { track, trackSid: 'camera-sid', source: options.source };
      },
      unpublishTrack: async (track: unknown) => {
        unpublished.push(track);
      }
    }
  };
  Object.assign(lk.state, { joined: true, livekitRoom: room, self: { id: 'self' }, cameraDeviceId: '' });
  const showToast = vi.fn();
  vi.doMock('../../src/lib/features/room/client/ui/toast', () => ({ showToast }));
  const camera = await import('../../src/lib/features/room/client/services/camera-service.ts');
  return { lk, camera, published, unpublished, showToast };
}

test('turning the camera on captures 720p and publishes it with lighter layers; off stops it', async () => {
  const capture = fakeCapture();
  const requests: MediaStreamConstraints[] = [];
  const { lk, camera, published, unpublished } = await loadLocalCamera(async (constraints) => {
    requests.push(constraints);
    return capture.stream;
  });

  await camera.toggleCamera();
  expect(requests[0]).toMatchObject({ audio: false, video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
  expect(published).toHaveLength(1);
  expect(published[0].options).toMatchObject({ source: 'camera', simulcast: true });
  expect(published[0].options.videoSimulcastLayers).toHaveLength(2);
  const self = lk.state.self as { camera: boolean; cameraStream: unknown };
  expect(self).toMatchObject({ camera: true, cameraStream: capture.stream });

  await camera.toggleCamera();
  expect(unpublished).toEqual([capture.track]);
  expect(capture.track.stopped).toBe(true);
  expect(self).toMatchObject({ camera: false, cameraStream: null });
  expect(lk.state.localCameraStream).toBeNull();
});

test('a camera that is unplugged turns itself off and says so', async () => {
  const capture = fakeCapture();
  const { lk, camera, unpublished, showToast } = await loadLocalCamera(async () => capture.stream);
  await camera.toggleCamera();

  capture.end();
  await flushMicrotasks();
  expect(lk.state.localCameraStream).toBeNull();
  expect(unpublished).toEqual([capture.track]);
  expect(showToast).toHaveBeenCalledWith('Камера отключилась');
});

test('a refused camera stays off and nothing is published', async () => {
  const { lk, camera, published } = await loadLocalCamera(async () => {
    throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
  });
  await camera.toggleCamera();
  expect(published).toEqual([]);
  expect(lk.state.localCameraStream).toBeNull();
  expect(lk.state.cameraStarting).toBe(false);
  expect(camera.describeCameraError({ name: 'NotAllowedError' })).toMatch(/Нет доступа к камере/);
  expect(camera.describeCameraError({ name: 'NotReadableError' })).toMatch(/занята/);
});

test('a remembered camera that is gone falls back to the system one and is forgotten', async () => {
  const capture = fakeCapture();
  const requests: MediaStreamConstraints[] = [];
  const { lk, camera } = await loadLocalCamera(async (constraints) => {
    requests.push(constraints);
    if ((constraints.video as { deviceId?: unknown }).deviceId) {
      throw Object.assign(new Error('gone'), { name: 'OverconstrainedError' });
    }
    return capture.stream;
  });
  lk.state.cameraDeviceId = 'usb-cam';

  await camera.toggleCamera();
  expect(requests).toHaveLength(2);
  expect((requests[1].video as { deviceId?: unknown }).deviceId).toBeUndefined();
  expect(lk.state.cameraDeviceId).toBe('');
  expect(lk.state.localCameraStream).toBe(capture.stream);
});
