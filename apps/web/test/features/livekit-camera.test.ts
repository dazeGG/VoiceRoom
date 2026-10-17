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

function fakeCapture(settings: MediaTrackSettings = {}) {
  const ended: Array<() => void> = [];
  const track = {
    kind: 'video',
    getSettings: () => settings,
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
  Object.assign(lk.state, {
    joined: true,
    livekitRoom: room,
    self: { id: 'self' },
    cameraDeviceId: '',
    cameraFacing: 'user'
  });
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
  // A computer asks for no facing: it would prefer the built-in camera over the default one.
  expect(facingOf(requests[0])).toBeUndefined();
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

function facingOf(constraints: MediaStreamConstraints): unknown {
  return (constraints.video as { facingMode?: unknown }).facingMode;
}

test('flipping turns a phone to its back camera and back, releasing one camera before opening the other', async () => {
  const captures: Array<ReturnType<typeof fakeCapture>> = [];
  const requests: MediaStreamConstraints[] = [];
  const { lk, camera, published, unpublished } = await loadLocalCamera(async (constraints) => {
    // A phone opens one camera at a time.
    expect(captures.filter((capture) => !capture.track.stopped)).toHaveLength(0);
    requests.push(constraints);
    const capture = fakeCapture();
    captures.push(capture);
    return capture.stream;
  });
  lk.state.cameraDeviceId = 'front-cam';

  await camera.toggleCamera();
  await camera.flipCamera();
  expect(facingOf(requests[1])).toEqual({ exact: 'environment' });
  expect(lk.state.cameraFacing).toBe('environment');
  expect(lk.state.cameraDeviceId).toBe('');
  expect(unpublished).toEqual([captures[0].track]);
  expect(published.map((entry) => entry.track)).toEqual([captures[0].track, captures[1].track]);
  expect(lk.state.localCameraStream).toBe(captures[1].stream);
  expect((lk.state.self as { cameraStream: unknown }).cameraStream).toBe(captures[1].stream);

  await camera.flipCamera();
  expect(facingOf(requests[2])).toEqual({ exact: 'user' });
  expect(lk.state.cameraFacing).toBe('user');

  // Turned off and on again, the camera opens on the side it was left on.
  await camera.flipCamera();
  await camera.toggleCamera();
  await camera.toggleCamera();
  expect(facingOf(requests.at(-1)!)).toEqual({ ideal: 'environment' });
});

test('a phone with one camera stays on it when flipped and says so', async () => {
  const captures: Array<ReturnType<typeof fakeCapture>> = [];
  const requests: MediaStreamConstraints[] = [];
  const { lk, camera, published, showToast } = await loadLocalCamera(async (constraints) => {
    requests.push(constraints);
    if ((facingOf(constraints) as { exact?: string } | undefined)?.exact === 'environment') {
      throw Object.assign(new Error('no back camera'), { name: 'OverconstrainedError' });
    }
    // Its one camera reports a device but no facing.
    const capture = fakeCapture({ deviceId: 'only-cam' });
    captures.push(capture);
    return capture.stream;
  });

  await camera.toggleCamera();
  await camera.flipCamera();
  expect(showToast).toHaveBeenCalledWith('Другой камеры нет');
  // Reopened by the device it was on, not by a facing it never reported.
  expect((requests.at(-1)!.video as { deviceId?: unknown }).deviceId).toEqual({ exact: 'only-cam' });
  expect(lk.state.cameraFacing).toBe('user');
  expect(captures[0].track.stopped).toBe(true);
  expect(lk.state.localCameraStream).toBe(captures[1].stream);
  expect(published.at(-1)?.track).toBe(captures[1].track);
  expect(lk.state.cameraStarting).toBe(false);
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

test('a back camera chosen by its device is taken for one: not mirrored, and the flip goes to the front', async () => {
  const requests: MediaStreamConstraints[] = [];
  const { lk, camera } = await loadLocalCamera(async (constraints) => {
    requests.push(constraints);
    return fakeCapture({ facingMode: requests.length === 1 ? 'environment' : 'user' }).stream;
  });
  lk.state.cameraDeviceId = 'rear-cam';

  await camera.toggleCamera();
  expect(lk.state.cameraFacing).toBe('environment');
  await camera.flipCamera();
  expect(facingOf(requests[1])).toEqual({ exact: 'user' });
  expect(lk.state.cameraFacing).toBe('user');
});

test('on a phone the camera layer follows its own big picture, whatever the desktop spotlight says', async () => {
  const { stubMatchMedia } = await import('../helpers/match-media.ts');
  const { lk, participantsUi, syncRemoteCameraDemand, camera, participant } = await loadRemoteCamera();
  const { mobileCallUi, PORTRAIT_PHONE_QUERY, resetMobileCall } =
    await import('../../src/lib/features/room/mobile-call-ui.svelte');
  stubMatchMedia([PORTRAIT_PHONE_QUERY]);
  lk.service.syncLiveKitParticipant(participant as never);
  await flushMicrotasks();
  Object.assign(lk.state, { screen: 'room', self: { id: 'self', isLocal: true, joinedAt: 0 } });
  mobileCallUi.enabled = true;
  try {
    // Left over from a screen view on the phone: it points at someone else.
    participantsUi.focusedParticipantId = 'someone-else';
    syncRemoteCameraDemand();
    await flushMicrotasks();
    // Two people: the other one fills the phone.
    expect(camera.calls.quality.at(-1)).toBe(HIGH);

    // Swapped, I fill the phone and they sit in the small picture.
    mobileCallUi.duoSwappedWith = 'peer-a';
    syncRemoteCameraDemand();
    await flushMicrotasks();
    expect(camera.calls.quality.at(-1)).toBe(LOW);
  } finally {
    mobileCallUi.enabled = false;
    resetMobileCall();
    participantsUi.focusedParticipantId = '';
  }
});

test('a camera that tells no facing is taken for a front one, not left as the back camera before it', async () => {
  let call = 0;
  const { lk, camera } = await loadLocalCamera(
    async () => fakeCapture(call++ === 0 ? { facingMode: 'environment' } : {}).stream
  );
  await camera.toggleCamera();
  expect(lk.state.cameraFacing).toBe('environment');
  await camera.switchCamera('usb-webcam');
  expect(lk.state.cameraFacing).toBe('user');
});
