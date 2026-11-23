// Cameras in the call: everyone's camera is received at once, at the layer
// its tile needs, and our own camera is captured, published and stopped.

import { afterEach, expect, test, vi } from 'vitest';
import type { MediaGrant } from '@voiceroom/shared/contracts/realtime';
import type * as ToastModule from '@voiceroom/call/engine/ui/toast';
import { defined, instanceOf } from '../helpers/assert.ts';
import { FakeMediaStream, FakeMediaStreamTrack } from '../helpers/fake-media.ts';
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
  const lk = await loadLiveKitHarness({
    autoResolveClient: true,
    requestToken: async () => ({ token: 't', url: 'wss://lk.example' })
  });
  const { useParticipantsUiStore } = await import('@voiceroom/call/engine/core/participants-ui.store');
  const participantsUi = useParticipantsUiStore();
  const { syncRemoteCameraDemand } = await import('@voiceroom/call/engine/services/livekit/remote-participants');
  const track = { mediaStreamTrack: { kind: 'video', readyState: 'live', id: 'camera-track' } };
  const camera = fakePublication('camera', { isSubscribed: true, track });
  const participant = fakeParticipant(peerId, [camera.publication]);
  lk.state.serverPeerIds.add(peerId);
  return { lk, participantsUi, syncRemoteCameraDemand, camera, participant, track };
}

test('a remote camera is received at once and its picture reaches the tile', async () => {
  const { lk, camera, participant, track } = await loadRemoteCamera();
  lk.syncParticipant(participant);
  await flushMicrotasks();

  expect(camera.calls.subscribed).toEqual([true]);
  const peer = defined(lk.state.peers.get('peer-a'), 'peer-a');
  expect(peer.camera).toBe(true);
  expect(instanceOf(peer.cameraStream, TestMediaStream, 'camera stream').getVideoTracks()).toEqual([
    track.mediaStreamTrack
  ]);
});

test('the camera layer follows the tile: roomy grid, spotlight, crowded call', async () => {
  const { lk, participantsUi, syncRemoteCameraDemand, camera, participant } = await loadRemoteCamera();
  lk.syncParticipant(participant);
  await flushMicrotasks();
  expect(camera.calls.quality.at(-1)).toBe(MEDIUM);

  participantsUi.focusedParticipantId = 'peer-a';
  await syncRemoteCameraDemand();
  expect(camera.calls.quality.at(-1)).toBe(HIGH);

  participantsUi.focusedParticipantId = '';
  for (const id of ['b', 'c', 'd', 'e']) lk.state.peers.set(id, { id });
  await syncRemoteCameraDemand();
  expect(camera.calls.quality.at(-1)).toBe(LOW);
});

test('a camera that is turned off leaves the tile', async () => {
  const { lk, camera, participant } = await loadRemoteCamera();
  await lk.service.connectLiveKitRoom('room-1');
  lk.syncParticipant(participant);
  await flushMicrotasks();

  participant.trackPublications.delete(camera.publication.trackSid);
  defined(lk.rooms[0], 'LiveKit room').emit('TrackUnpublished', camera.publication, participant);
  const peer = defined(lk.state.peers.get('peer-a'), 'peer-a');
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
      this.readyState = 'ended';
    },
    addEventListener: (_event: string, listener: () => void) => ended.push(listener)
  };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  return { stream, track, end: () => ended.forEach((listener) => listener()) };
}

// The server's answer to the camera's media request; null is no answer at all.
const GRANTED: MediaGrant = { roomId: 'room-1', kind: 'camera', granted: true };

function fakeCameraSender() {
  let encodings = [
    { rid: 'f', active: true },
    { rid: 'h', active: true }
  ];
  return {
    getParameters: () => ({ encodings: structuredClone(encodings) }),
    setParameters: vi.fn(async (parameters: { encodings: typeof encodings }) => {
      encodings = parameters.encodings;
    })
  };
}

async function loadLocalCamera(
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<unknown>,
  grant: MediaGrant | null = GRANTED,
  cameraCodec: 'h264' | 'vp8' = 'h264'
) {
  const lk = await loadLiveKitHarness({ autoResolveClient: true, cameraCodec });
  const presence: Array<Record<string, unknown>> = [];
  const { getCallPorts } = await import('@voiceroom/call/engine/ports');
  const ports = getCallPorts();
  ports.transport = {
    ...ports.transport,
    realtime: {
      ...ports.transport.realtime,
      requestMediaGrant: async () => grant,
      updatePeer: ({ patch }) => {
        presence.push(patch);
      }
    }
  };
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  const published: Array<{ track: unknown; options: Record<string, unknown> }> = [];
  const unpublished: unknown[] = [];
  const sender = fakeCameraSender();
  const room = {
    localParticipant: {
      trackPublications: new Map<string, unknown>(),
      publishTrack: async (track: unknown, options: Record<string, unknown>) => {
        published.push({ track, options });
        return {
          track: { mediaStreamTrack: track },
          trackSid: 'camera-sid',
          source: options.source,
          videoTrack: { sender }
        };
      },
      unpublishTrack: async (track: unknown) => {
        unpublished.push(
          typeof track === 'object' && track !== null && 'mediaStreamTrack' in track ? track.mediaStreamTrack : track
        );
      }
    }
  };
  Object.assign(lk.state, {
    joined: true,
    livekitRoom: room,
    self: { id: 'self', camera: false, cameraStream: null },
    localCameraStream: null,
    localCameraPublication: null,
    cameraDeviceId: '',
    cameraFacing: 'user'
  });
  const toast = await vi.importActual<typeof ToastModule>('@voiceroom/call/engine/ui/toast');
  const showToast = vi.fn(toast.showToast);
  vi.doMock('@voiceroom/call/engine/ui/toast', () => ({ showToast }));
  const { useToastUiStore } = await import('@voiceroom/call/engine/core/toast-ui.store');
  const toasts = useToastUiStore();
  toasts.useViewportTimers();
  const camera = await import('@voiceroom/call/engine/services/camera-service');
  return { lk, camera, room, published, unpublished, showToast, toasts, presence, sender };
}

test('turning the camera on captures 540p at 24 fps and publishes it with lighter layers; off stops it', async () => {
  const capture = fakeCapture();
  const requests: MediaStreamConstraints[] = [];
  const { lk, camera, published, unpublished } = await loadLocalCamera(async (constraints) => {
    requests.push(constraints);
    return capture.stream;
  });

  await camera.toggleCamera();
  expect(requests[0]).toMatchObject({
    audio: false,
    video: { width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 24, max: 24 } }
  });
  // A computer asks for no facing: it would prefer the built-in camera over the default one.
  expect(facingOf(requests[0])).toBeUndefined();
  expect(published).toHaveLength(1);
  expect(defined(published[0], 'published[0]').options).toMatchObject({ source: 'camera', simulcast: true });
  const options = defined(published[0], 'published[0]').options;
  // H.264 for the hardware encoders and decoders, VP8 for viewers without it; 24 fps on every layer.
  expect(options).toMatchObject({
    videoCodec: 'h264',
    backupCodec: { codec: 'vp8', encoding: { maxFramerate: 24 } },
    videoEncoding: { maxFramerate: 24 }
  });
  // The fake VideoPreset keeps its constructor arguments: width, height, bitrate, frame rate.
  const isList = (value: unknown): value is readonly unknown[] => Array.isArray(value);
  const argsOf = (layer: unknown): readonly unknown[] =>
    typeof layer === 'object' && layer !== null && 'args' in layer && isList(layer.args) ? layer.args : [];
  const layers: unknown = options.videoSimulcastLayers;
  expect(isList(layers) ? layers.map((layer) => [argsOf(layer)[1], argsOf(layer)[3]]) : []).toEqual([
    [180, 24],
    [360, 24]
  ]);
  const self = lk.state.self;
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

test('leaving and rejoining while the camera prompt is pending never publishes the old capture', async () => {
  const capture = fakeCapture();
  const pending = Promise.withResolvers<unknown>();
  const getUserMedia = vi.fn(() => pending.promise);
  const { lk, camera, published } = await loadLocalCamera(getUserMedia);

  const opening = camera.toggleCamera();
  await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
  camera.stopLocalCamera();
  lk.state.joined = false;
  lk.state.self = null;
  Object.assign(lk.state, { joined: true, self: { id: 'self' } });

  pending.resolve(capture.stream);
  await opening;
  expect(capture.track.stopped).toBe(true);
  expect(published).toHaveLength(0);
  expect(lk.state.localCameraStream).toBeNull();
});

test('dismissing the camera permission prompt offers a single action that retries the start', async () => {
  const capture = fakeCapture();
  const getUserMedia = vi
    .fn(async () => capture.stream)
    .mockRejectedValueOnce(new DOMException('Permission dismissed', 'NotAllowedError'));
  const { lk, camera, published, presence, toasts } = await loadLocalCamera(getUserMedia);

  await camera.toggleCamera();
  expect(getUserMedia).toHaveBeenCalledOnce();
  expect(lk.state.localCameraStream).toBeNull();
  expect(published).toEqual([]);
  expect(presence).toEqual([]);
  expect(toasts.items).toHaveLength(1);
  const toast = defined(toasts.items[0], 'dismissal toast');
  expect(toast.message).toBe('Запрос доступа к камере закрыт');
  expect(toast.actions).toHaveLength(1);
  const retry = defined(toast.actions?.[0], 'retry action');
  expect(retry.label).toBe('Повторить');

  retry.onClick(toast.id);
  await vi.waitFor(() => expect(lk.state.self).toMatchObject({ camera: true, cameraStream: capture.stream }));
  expect(getUserMedia).toHaveBeenCalledTimes(2);
  expect(toasts.items).toEqual([]);
  expect(published.map(({ track }) => track)).toEqual([capture.track]);
  expect(lk.state.localCameraPublication).toMatchObject({ trackSid: 'camera-sid' });
  expect(presence.map((patch) => patch.camera)).toEqual([true]);
});

test('a refused camera stays off and nothing is published', async () => {
  const { lk, camera, published, toasts } = await loadLocalCamera(async () => {
    throw new DOMException('Permission denied', 'NotAllowedError');
  });
  await camera.toggleCamera();
  expect(published).toEqual([]);
  expect(lk.state.localCameraStream).toBeNull();
  expect(lk.state.cameraStarting).toBe(false);
  expect(toasts.items).toMatchObject([
    { message: 'Нет доступа к камере: разрешите её в браузере', actions: undefined }
  ]);
  expect(camera.describeCameraError({ name: 'NotReadableError' })).toMatch(/занята/);
});

test('a camera whose publication rejects never appears on, even while publishing', async () => {
  const capture = fakeCapture();
  const { lk, camera, room, presence, showToast } = await loadLocalCamera(async () => capture.stream);
  const { postState } = await import('@voiceroom/call/engine/room/presence');
  const pending = Promise.withResolvers<never>();
  const publish = vi.spyOn(room.localParticipant, 'publishTrack').mockReturnValueOnce(pending.promise);

  const starting = camera.toggleCamera();
  await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce());
  const streamWhilePublishing = lk.state.localCameraStream;
  const cameraWhilePublishing = lk.state.self?.camera;
  await postState();
  pending.reject(new Error('publish failed'));
  await starting;

  expect(streamWhilePublishing).toBeNull();
  expect(cameraWhilePublishing).not.toBe(true);
  expect(capture.track.stopped).toBe(true);
  expect(lk.state.localCameraStream).toBeNull();
  expect(lk.state.self?.camera).not.toBe(true);
  expect(lk.state.localCameraPublication).toBeNull();
  expect(presence.map((patch) => patch.camera)).toEqual([false]);
  expect(showToast).toHaveBeenCalledWith('Не удалось включить камеру');
});

test.each(['missing room', 'ended track'])(
  'camera start cleans up when there is no publication: %s',
  async (reason) => {
    const capture = fakeCapture();
    const { lk, camera, presence, published, showToast } = await loadLocalCamera(async () => capture.stream);
    if (reason === 'missing room') lk.state.livekitRoom = null;
    else capture.track.readyState = 'ended';

    await camera.toggleCamera();

    expect(capture.track.stopped).toBe(true);
    expect(lk.state.localCameraStream).toBeNull();
    expect(lk.state.self?.camera).not.toBe(true);
    expect(lk.state.localCameraPublication).toBeNull();
    expect(published).toEqual([]);
    expect(presence).toEqual([]);
    expect(showToast).toHaveBeenCalledWith('Не удалось включить камеру');
  }
);

test('camera stop releases the capture before unpublish and leaves a quick restart alone', async () => {
  const first = fakeCapture();
  const second = fakeCapture();
  const getUserMedia = vi.fn(async () => second.stream).mockResolvedValueOnce(first.stream);
  const { lk, camera, room, published, presence } = await loadLocalCamera(getUserMedia);
  const pending = Promise.withResolvers<void>();
  const unpublish = vi.spyOn(room.localParticipant, 'unpublishTrack').mockReturnValueOnce(pending.promise);
  await camera.toggleCamera();

  const stopping = camera.toggleCamera();
  const firstStoppedImmediately = first.track.stopped;
  const presenceAtStop = presence.map((patch) => patch.camera);
  await camera.toggleCamera();
  const newPublication = lk.state.localCameraPublication;
  pending.resolve();
  await stopping;

  expect(firstStoppedImmediately).toBe(true);
  expect(presenceAtStop).toEqual([true, false]);
  expect(unpublish).toHaveBeenCalledExactlyOnceWith({ mediaStreamTrack: first.track }, false);
  expect(published.map(({ track }) => track)).toEqual([first.track, second.track]);
  expect(second.track.stopped).toBe(false);
  expect(lk.state.self).toMatchObject({ camera: true, cameraStream: second.stream });
  expect(lk.state.localCameraStream).toBe(second.stream);
  expect(newPublication).toMatchObject({ track: { mediaStreamTrack: second.track } });
  expect(lk.state.localCameraPublication).toBe(newPublication);
  expect(presence.map((patch) => patch.camera)).toEqual([true, false, true]);
});

test('a failed camera unpublish remains available for cleanup after a restart', async () => {
  const first = fakeCapture();
  const second = fakeCapture();
  const getUserMedia = vi.fn(async () => second.stream).mockResolvedValueOnce(first.stream);
  const { lk, camera, room, unpublished } = await loadLocalCamera(getUserMedia);
  vi.spyOn(room.localParticipant, 'unpublishTrack').mockRejectedValueOnce(new Error('unpublish failed'));

  await camera.toggleCamera();
  await camera.toggleCamera();
  await camera.toggleCamera();
  expect(lk.state.localCameraStream).toBe(second.stream);
  await camera.toggleCamera();

  expect(first.track.stopped).toBe(true);
  expect(second.track.stopped).toBe(true);
  expect(unpublished).toEqual(expect.arrayContaining([first.track, second.track]));
  expect(unpublished).toHaveLength(2);
  expect(lk.state.localCameraPublication).toBeNull();
});

function videoOf(constraints: MediaStreamConstraints | undefined): MediaTrackConstraints {
  const video = constraints?.video;
  if (typeof video !== 'object') throw new Error('the request asks for no camera settings');
  return video;
}

function facingOf(constraints: MediaStreamConstraints | undefined): ConstrainDOMString | undefined {
  return videoOf(constraints).facingMode;
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
  expect(unpublished).toEqual([defined(captures[0], 'captures[0]').track]);
  expect(published.map((entry) => entry.track)).toEqual([
    defined(captures[0], 'captures[0]').track,
    defined(captures[1], 'captures[1]').track
  ]);
  expect(lk.state.localCameraStream).toBe(defined(captures[1], 'captures[1]').stream);
  expect(lk.state.self?.cameraStream).toBe(defined(captures[1], 'captures[1]').stream);

  await camera.flipCamera();
  expect(facingOf(requests[2])).toEqual({ exact: 'user' });
  expect(lk.state.cameraFacing).toBe('user');

  // Turned off and on again, the camera opens on the side it was left on.
  await camera.flipCamera();
  await camera.toggleCamera();
  await camera.toggleCamera();
  expect(facingOf(requests.at(-1))).toEqual({ ideal: 'environment' });
});

test('a phone with one camera stays on it when flipped and says so', async () => {
  const captures: Array<ReturnType<typeof fakeCapture>> = [];
  const requests: MediaStreamConstraints[] = [];
  const { lk, camera, published, showToast } = await loadLocalCamera(async (constraints) => {
    requests.push(constraints);
    const facing = facingOf(constraints);
    if (typeof facing === 'object' && !Array.isArray(facing) && facing.exact === 'environment') {
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
  expect(videoOf(requests.at(-1)).deviceId).toEqual({ exact: 'only-cam' });
  expect(lk.state.cameraFacing).toBe('user');
  expect(defined(captures[0], 'captures[0]').track.stopped).toBe(true);
  expect(lk.state.localCameraStream).toBe(defined(captures[1], 'captures[1]').stream);
  expect(published.at(-1)?.track).toBe(defined(captures[1], 'captures[1]').track);
  expect(lk.state.cameraStarting).toBe(false);
});

test('a remembered camera that is gone falls back to the system one and is forgotten', async () => {
  const capture = fakeCapture();
  const requests: MediaStreamConstraints[] = [];
  const { lk, camera } = await loadLocalCamera(async (constraints) => {
    requests.push(constraints);
    if (videoOf(constraints).deviceId) {
      throw Object.assign(new Error('gone'), { name: 'OverconstrainedError' });
    }
    return capture.stream;
  });
  lk.state.cameraDeviceId = 'usb-cam';

  await camera.toggleCamera();
  expect(requests).toHaveLength(2);
  expect(videoOf(requests[1]).deviceId).toBeUndefined();
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
  const { usePageStore } = await import('@/stores/page.store');
  const { stubMatchMedia } = await import('../helpers/match-media.ts');
  const { lk, participantsUi, syncRemoteCameraDemand, camera, participant } = await loadRemoteCamera();
  const { useMobileCallUiStore, PORTRAIT_PHONE_QUERY } = await import('@/features/room/mobile-call-ui.store');
  const mobileCallUi = useMobileCallUiStore();
  stubMatchMedia([PORTRAIT_PHONE_QUERY]);
  lk.syncParticipant(participant);
  await flushMicrotasks();
  usePageStore().screen = 'room';
  Object.assign(lk.state, { self: { id: 'self', isLocal: true, joinedAt: 0 } });
  mobileCallUi.enabled = true;
  try {
    // Left over from a screen view on the phone: it points at someone else.
    participantsUi.focusedParticipantId = 'someone-else';
    await syncRemoteCameraDemand();
    // Two people: the other one fills the phone.
    expect(camera.calls.quality.at(-1)).toBe(HIGH);

    // Swapped, I fill the phone and they sit in the small picture.
    mobileCallUi.duoSwappedWith = 'peer-a';
    await syncRemoteCameraDemand();
    expect(camera.calls.quality.at(-1)).toBe(LOW);
  } finally {
    mobileCallUi.enabled = false;
    mobileCallUi.resetMobileCall();
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

test('the camera tells the server it is on and off, so the media budget counts it', async () => {
  const capture = fakeCapture();
  const { camera, presence } = await loadLocalCamera(async () => capture.stream);

  await camera.toggleCamera();
  expect(presence.at(-1)).toMatchObject({ camera: true });
  await camera.toggleCamera();
  expect(presence.at(-1)).toMatchObject({ camera: false });
});

test('a busy server keeps the camera off before it is even opened, and says why', async () => {
  const getUserMedia = vi.fn(async () => fakeCapture().stream);
  const { lk, camera, published, showToast } = await loadLocalCamera(getUserMedia, {
    roomId: 'room-1',
    kind: 'camera',
    granted: false,
    reason: 'server_busy'
  });

  await camera.toggleCamera();
  expect(getUserMedia).not.toHaveBeenCalled();
  expect(published).toEqual([]);
  expect(lk.state.cameraStarting).toBe(false);
  expect(showToast).toHaveBeenCalledWith('Сервер сейчас загружен, камера недоступна. Попробуйте через пару минут', {
    duration: 12000,
    variant: 'error'
  });
});

test('a browser without H.264 sends its camera in VP8, with no backup to fall back to', async () => {
  const capture = fakeCapture();
  const { camera, published } = await loadLocalCamera(async () => capture.stream, GRANTED, 'vp8');
  await camera.toggleCamera();
  expect(defined(published[0], 'published[0]').options).toMatchObject({ videoCodec: 'vp8', backupCodec: false });
});

test('an overloaded computer lightens video silently: our camera stops at 360p, others come in small unless large', async () => {
  const { lk, participantsUi, camera, participant } = await loadRemoteCamera();
  const { relieveVideo } = await import('@voiceroom/call/engine/services/video-relief');
  lk.syncParticipant(participant);
  await flushMicrotasks();
  expect(camera.calls.quality.at(-1)).toBe(MEDIUM);

  const sender = fakeCameraSender();
  Object.assign(lk.state, { joined: true, localCameraPublication: { videoTrack: { sender } } });
  await relieveVideo();
  await flushMicrotasks();
  expect(lk.state.videoRelieved).toBe(true);
  expect(sender.getParameters().encodings).toEqual([
    { rid: 'f', active: false },
    { rid: 'h', active: true }
  ]);
  expect(camera.calls.quality.at(-1)).toBe(LOW);

  // A camera opened large still comes in full.
  participantsUi.focusedParticipantId = 'peer-a';
  const { syncRemoteCameraDemand } = await import('@voiceroom/call/engine/services/livekit/remote-participants');
  await syncRemoteCameraDemand();
  expect(camera.calls.quality.at(-1)).toBe(HIGH);
});

test('a camera turned on after the call was lightened starts at 360p', async () => {
  const capture = fakeCapture();
  const { lk, camera, sender } = await loadLocalCamera(async () => capture.stream);
  const { processingReliefForPoll, startCaptureDiagnostics, stopCaptureDiagnostics } =
    await import('@voiceroom/call/engine/room/capture-diagnostics');
  lk.state.videoRelieved = true;
  startCaptureDiagnostics();
  try {
    await camera.toggleCamera();
    expect(sender.getParameters().encodings).toEqual([
      { rid: 'f', active: false },
      { rid: 'h', active: true }
    ]);
    expect(processingReliefForPoll()).toMatchObject([{ kind: 'video', outcome: 'applied' }]);
  } finally {
    stopCaptureDiagnostics();
  }
});

test.each(['success', 'rejected', 'missing encoding'])(
  'camera relief reports the confirmed encoding result (%s)',
  async (result) => {
    const { lk } = await loadRemoteCamera();
    const { relieveVideo } = await import('@voiceroom/call/engine/services/video-relief');
    const update = Promise.withResolvers<void>();
    const encodings =
      result === 'missing encoding'
        ? []
        : [
            { rid: 'f', active: true },
            { rid: 'h', active: true }
          ];
    let current = encodings;
    const sender = {
      getParameters: () => ({ encodings: structuredClone(current) }),
      setParameters: vi.fn(async (parameters: { encodings: typeof encodings }) => {
        await update.promise;
        current = parameters.encodings;
      })
    };
    Object.assign(lk.state, { joined: true, localCameraPublication: { videoTrack: { sender } } });
    const note = vi.fn();
    const relief = relieveVideo(note);
    await flushMicrotasks();
    if (result === 'success') update.resolve();
    if (result === 'rejected') {
      void update.promise.catch(() => {});
      update.reject(new Error('sender refused the update'));
    }
    if (result !== 'missing encoding') expect(note).not.toHaveBeenCalled();
    await relief;
    expect(note).toHaveBeenCalledExactlyOnceWith({
      kind: 'video',
      outcome: result === 'success' ? 'applied' : 'failed'
    });
    if (result === 'success')
      expect(current).toEqual([
        { rid: 'f', active: false },
        { rid: 'h', active: true }
      ]);
  }
);

async function loadScreenRelief(profileId = 'balanced-30', settings: MediaTrackSettings = { frameRate: 30 }) {
  const { lk } = await loadRemoteCamera();
  const { applyVideoReliefToScreen } = await import('@voiceroom/call/engine/services/video-relief');
  const video = new FakeMediaStreamTrack('screen-video', 'video');
  video.contentHint = 'motion';
  video.getSettings = () => settings;
  const applyConstraints = vi.spyOn(video, 'applyConstraints');
  const audio = new FakeMediaStreamTrack('screen-audio', 'audio');
  const stream = new FakeMediaStream([video, audio]);
  Object.assign(lk.state, { localScreenStream: stream, localScreenProfileId: profileId });
  return { lk, applyVideoReliefToScreen, video, audio, stream, applyConstraints };
}

test.each([30, 60])('screen relief lowers a %i fps capture to 15 without touching audio or mode', async (frameRate) => {
  const settings = { frameRate, width: 1280, height: 720 };
  const capture = await loadScreenRelief(`balanced-${frameRate}`, settings);
  await capture.applyVideoReliefToScreen(capture.stream);
  expect(capture.applyConstraints).not.toHaveBeenCalled();

  capture.lk.state.videoRelieved = true;
  await capture.applyVideoReliefToScreen(capture.stream);
  expect(capture.applyConstraints).toHaveBeenCalledExactlyOnceWith({ frameRate: { max: 15 } });
  expect(capture.video.contentHint).toBe('motion');
  expect(capture.video.getSettings()).toEqual(settings);
  expect(capture.stream.getAudioTracks()).toEqual([capture.audio]);
  expect(capture.audio.readyState).toBe('live');
  expect(capture.lk.state.localScreenProfileId).toBe(`balanced-${frameRate}`);
});

test.each(['balanced-15', 'source-5'])(
  'relief never raises a low selected profile %s with unknown settings',
  async (profile) => {
    const capture = await loadScreenRelief(profile, {});
    const applyProfile = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('voiceRoomDesktopCapture', { applyProfile });
    capture.lk.state.videoRelieved = true;
    await capture.applyVideoReliefToScreen(capture.stream);
    expect(applyProfile).not.toHaveBeenCalled();
    expect(capture.applyConstraints).not.toHaveBeenCalled();
  }
);

test.each([5, 15])('relief does not raise a known %i fps capture', async (frameRate) => {
  const capture = await loadScreenRelief('balanced-30', { frameRate });
  capture.lk.state.videoRelieved = true;
  await capture.applyVideoReliefToScreen(capture.stream);
  expect(capture.applyConstraints).not.toHaveBeenCalled();
});

test('browser relief preserves existing resolution and other capture constraints', async () => {
  const capture = await loadScreenRelief();
  capture.video.getConstraints = () => ({
    frameRate: { ideal: 30, max: 30 },
    width: { max: 1280 },
    height: { max: 720 },
    resizeMode: 'crop-and-scale'
  });
  capture.lk.state.videoRelieved = true;
  await capture.applyVideoReliefToScreen(capture.stream);
  expect(capture.applyConstraints).toHaveBeenCalledExactlyOnceWith({
    frameRate: { max: 15 },
    width: { max: 1280 },
    height: { max: 720 },
    resizeMode: 'crop-and-scale'
  });
});

test.each(['balanced', 'high', 'source'])(
  'native %s-30 relief reaches the helper even with unknown generator FPS',
  async (qualityId) => {
    const capture = await loadScreenRelief(`${qualityId}-30`, {});
    const applyProfile = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('voiceRoomDesktopCapture', { applyProfile });
    capture.lk.state.videoRelieved = true;
    await capture.applyVideoReliefToScreen(capture.stream);
    expect(applyProfile).toHaveBeenCalledExactlyOnceWith({ fpsId: '15', qualityId });
    expect(capture.applyConstraints).not.toHaveBeenCalled();
    expect(capture.video.contentHint).toBe('motion');
    expect(capture.lk.state.localScreenProfileId).toBe(`${qualityId}-30`);
    expect(capture.stream.getAudioTracks()).toEqual([capture.audio]);
  }
);

test.each(['refused', 'rejected'])('native %s relief falls back to frame-rate-only constraints', async (failure) => {
  const capture = await loadScreenRelief();
  const applyProfile = vi.fn(async () => {
    if (failure === 'rejected') throw new Error('helper unavailable');
    return { ok: false };
  });
  vi.stubGlobal('voiceRoomDesktopCapture', { applyProfile });
  capture.lk.state.videoRelieved = true;
  await capture.applyVideoReliefToScreen(capture.stream);
  expect(applyProfile).toHaveBeenCalledOnce();
  expect(capture.applyConstraints).toHaveBeenCalledExactlyOnceWith({ frameRate: { max: 15 } });
});

test('native source-60 relief must not raise the helper resolution ceiling', async () => {
  const capture = await loadScreenRelief('source-60', {});
  const applyProfile = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal('voiceRoomDesktopCapture', { applyProfile });
  capture.lk.state.videoRelieved = true;
  await capture.applyVideoReliefToScreen(capture.stream);
  expect(applyProfile).not.toHaveBeenCalled();
  expect(capture.applyConstraints).toHaveBeenCalledExactlyOnceWith({ frameRate: { max: 15 } });
});

test.each(['stale', 'ended'])('%s screen relief does not reconfigure the active desktop capture', async (reason) => {
  const capture = await loadScreenRelief();
  const applyProfile = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal('voiceRoomDesktopCapture', { applyProfile });
  capture.lk.state.videoRelieved = true;
  if (reason === 'stale') capture.lk.state.localScreenStream = null;
  else capture.video.stop();
  await capture.applyVideoReliefToScreen(capture.stream);
  expect(applyProfile).not.toHaveBeenCalled();
  expect(capture.applyConstraints).not.toHaveBeenCalled();
});

test('a screen that ends while native relief is pending gets no fallback', async () => {
  const capture = await loadScreenRelief();
  const applyProfile = vi.fn(async () => {
    capture.lk.state.localScreenStream = null;
    return { ok: false };
  });
  vi.stubGlobal('voiceRoomDesktopCapture', { applyProfile });
  capture.lk.state.videoRelieved = true;
  await capture.applyVideoReliefToScreen(capture.stream);
  expect(applyProfile).toHaveBeenCalledOnce();
  expect(capture.applyConstraints).not.toHaveBeenCalled();
});

test('a capture refusing relief stays live without breaking the call', async () => {
  const capture = await loadScreenRelief();
  capture.applyConstraints.mockRejectedValue(new Error('OverconstrainedError'));
  capture.lk.state.videoRelieved = true;
  await expect(capture.applyVideoReliefToScreen(capture.stream)).resolves.toBe(false);
  expect(capture.video.readyState).toBe('live');
  expect(capture.audio.readyState).toBe('live');
});

test.each([true, false])('screen relief reports its own capture result (accepted: %s)', async (accepted) => {
  const capture = await loadScreenRelief();
  if (!accepted) capture.applyConstraints.mockRejectedValue(new Error('OverconstrainedError'));
  capture.lk.state.joined = true;
  const { relieveVideo } = await import('@voiceroom/call/engine/services/video-relief');
  const note = vi.fn();
  await relieveVideo(note);
  expect(note).toHaveBeenCalledExactlyOnceWith({ kind: 'screen', outcome: accepted ? 'applied' : 'failed' });
});

test('a new screen and its republication retain relief through the real publish path', async () => {
  const capture = await loadScreenRelief();
  capture.lk.state.localScreenStream = null;
  await capture.lk.service.connectLiveKitRoom('room-1');
  capture.lk.state.videoRelieved = true;
  capture.lk.state.localScreenStream = capture.stream;
  await capture.lk.service.publishLocalScreenTracks();
  expect(capture.applyConstraints).toHaveBeenCalledExactlyOnceWith({ frameRate: { max: 15 } });
  const room = defined(capture.lk.rooms[0], 'connected room');
  expect(room.published.map((item) => item.track)).toEqual([capture.video, capture.audio]);

  await capture.lk.service.unpublishLocalScreenTracks(false);
  capture.applyConstraints.mockClear();
  await capture.lk.service.publishLocalScreenTracks();
  expect(capture.applyConstraints).toHaveBeenCalledExactlyOnceWith({ frameRate: { max: 15 } });
  expect(capture.video.readyState).toBe('live');
  expect(capture.audio.readyState).toBe('live');
});

test.each(['applied', 'failed', 'no change'] as const)(
  'screen publication records its late relief result (%s)',
  async (outcome) => {
    const capture = await loadScreenRelief('balanced-30', { frameRate: outcome === 'no change' ? 15 : 30 });
    const { processingReliefForPoll, startCaptureDiagnostics, stopCaptureDiagnostics } =
      await import('@voiceroom/call/engine/room/capture-diagnostics');
    await capture.lk.service.connectLiveKitRoom('room-1');
    Object.assign(capture.lk.state, { joined: true, videoRelieved: true });
    if (outcome === 'failed') capture.applyConstraints.mockRejectedValue(new Error('OverconstrainedError'));
    startCaptureDiagnostics();
    try {
      await capture.lk.service.publishLocalScreenTracks();
      expect(processingReliefForPoll()).toMatchObject(outcome === 'no change' ? [] : [{ kind: 'screen', outcome }]);
    } finally {
      stopCaptureDiagnostics();
    }
  }
);

test('camera-off policy blocks local capture and remote camera subscription', async () => {
  const capture = vi.fn(async () => fakeCapture().stream);
  const { lk, camera: localCamera } = await loadLocalCamera(capture);
  const { getCallPorts } = await import('@voiceroom/call/engine/ports');
  getCallPorts().mediaPolicy = { camera: false };
  await localCamera.toggleCamera();
  expect(capture).not.toHaveBeenCalled();

  const remoteCamera = fakePublication('camera', { isSubscribed: true });
  const microphone = fakePublication('microphone');
  lk.state.serverPeerIds.add('remote');
  lk.syncParticipant(fakeParticipant('remote', [remoteCamera.publication, microphone.publication]));
  await flushMicrotasks();
  expect(remoteCamera.publication.isDesired).toBe(false);
  expect(remoteCamera.calls.subscribed).not.toContain(true);
  expect(microphone.calls.subscribed).toEqual([true]);
});
