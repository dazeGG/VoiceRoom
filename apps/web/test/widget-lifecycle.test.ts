import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';
import { WidgetMedia } from '../src/features/widget/media';
import { createWidgetRuntime } from '../src/features/widget/runtime';
const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  startAudio: vi.fn(async () => undefined),
  connect: vi.fn(),
  disconnect: vi.fn(),
  publish: vi.fn(),
  unpublish: vi.fn(),
  camera: vi.fn(),
  switchDevice: vi.fn(async () => true),
  canPlaybackAudio: true,
  localParticipants: Array<object>(),
  quality: 'unknown',
  connectionState: 'connected',
  audioPublications: Array<{ kind: string; isDesired: boolean; setSubscribed(value: boolean): void }>(),
  speakers: Array<{ identity: string }>(),
  listeners: new Map<string, (...args: unknown[]) => void>()
}));
vi.mock('../src/features/widget/capture', () => ({ openWidgetMicrophone: mocks.capture }));
vi.mock('@voice-room/call/livekit-runtime', () => ({
  loadLiveKitClient: async () => ({
    Room: class {
      localParticipant = {
        publishTrack: mocks.publish,
        unpublishTrack: mocks.unpublish,
        setCameraEnabled: mocks.camera,
        videoTrackPublications: { size: 1 },
        get connectionQuality() {
          return mocks.quality;
        }
      };
      remoteParticipants = new Map([
        ['existing', { audioTrackPublications: new Map(mocks.audioPublications.map((entry, index) => [index, entry])) }]
      ]);
      activeSpeakers = mocks.speakers;
      constructor() {
        mocks.localParticipants.push(this.localParticipant);
      }
      get state() {
        return mocks.connectionState;
      }
      get canPlaybackAudio(): boolean {
        return mocks.canPlaybackAudio;
      }
      on(event: string, callback: (...args: unknown[]) => void) {
        mocks.listeners.set(event, callback);
      }
      connect = mocks.connect;
      disconnect = mocks.disconnect;
      startAudio = mocks.startAudio;
      switchActiveDevice = mocks.switchDevice;
    },
    RoomEvent: {
      TrackSubscribed: 'sub',
      TrackPublished: 'published',
      TrackUnsubscribed: 'unsub',
      TrackMuted: 'mute',
      TrackUnmuted: 'unmute',
      AudioPlaybackStatusChanged: 'playback',
      ActiveSpeakersChanged: 'speakers',
      ConnectionStateChanged: 'connection',
      ConnectionQualityChanged: 'quality',
      Disconnected: 'disconnected'
    },
    ConnectionState: { Connected: 'connected' },
    Track: {
      Source: { Microphone: 'microphone', Camera: 'camera' },
      Kind: { Audio: 'audio', Video: 'video' }
    }
  })
}));
class FakeTrack extends EventTarget implements MediaStreamTrack {
  contentHint = '';
  enabled = true;
  id = 'track';
  kind = 'audio';
  label = 'Microphone';
  muted = false;
  onended = null;
  onmute = null;
  onunmute = null;
  readyState: MediaStreamTrackState = 'live';
  async applyConstraints() {}
  clone(): MediaStreamTrack {
    return this;
  }
  getCapabilities() {
    return {};
  }
  getConstraints() {
    return {};
  }
  getSettings() {
    return {};
  }
  stop() {
    this.readyState = 'ended';
  }
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.capture.mockReset();
  mocks.camera.mockReset();
  mocks.canPlaybackAudio = true;
  mocks.localParticipants.length = 0;
  mocks.quality = 'unknown';
  mocks.connectionState = 'connected';
  mocks.audioPublications.length = 0;
  mocks.speakers.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
  mocks.listeners.clear();
});
describe('widget lifecycle', () => {
  it('refreshes reactive quality for the local participant only and resets it during reconnect and leave', async () => {
    const runtime = createWidgetRuntime(document.createElement('div'), () => undefined);
    const quality = computed(() => runtime.connectionQuality());
    expect(quality.value).toBe('unknown');
    await runtime.media.connect('https://voice.test', 'token');
    mocks.quality = 'good';
    mocks.listeners.get('quality')?.('good', mocks.localParticipants.at(-1));
    expect(quality.value).toBe('good');
    mocks.quality = 'poor';
    mocks.listeners.get('quality')?.('lost', { identity: 'guest' });
    expect(quality.value).toBe('good');
    mocks.listeners.get('quality')?.('poor', mocks.localParticipants.at(-1));
    expect(quality.value).toBe('poor');
    mocks.quality = 'lost';
    mocks.listeners.get('quality')?.('lost', mocks.localParticipants.at(-1));
    expect(quality.value).toBe('lost');
    mocks.connectionState = 'reconnecting';
    mocks.listeners.get('connection')?.('reconnecting');
    expect(quality.value).toBe('unknown');
    mocks.connectionState = 'connected';
    mocks.quality = 'excellent';
    mocks.listeners.get('connection')?.('connected');
    expect(quality.value).toBe('excellent');
    runtime.leave();
    expect(quality.value).toBe('unknown');
  });
  it('lets voice-only widgets subscribe to existing and new audio while rejecting cameras', async () => {
    const mount = document.createElement('div');
    const existing = { kind: 'audio', isDesired: false, setSubscribed: vi.fn() };
    mocks.audioPublications.push(existing);
    const runtime = createWidgetRuntime(mount, () => undefined, false);
    await runtime.media.connect('https://voice.test', 'token');
    expect(mocks.connect).toHaveBeenCalledWith('https://voice.test', 'token', { autoSubscribe: false });
    expect(existing.setSubscribed).toHaveBeenCalledWith(true);
    const guest = { identity: 'guest' };
    const published = mocks.listeners.get('published');
    const audio = { kind: 'audio', isDesired: false, setSubscribed: vi.fn() };
    const camera = { kind: 'video', isDesired: false, setSubscribed: vi.fn() };
    published?.(audio, guest);
    published?.(camera, guest);
    expect(audio.setSubscribed).toHaveBeenCalledWith(true);
    expect(camera.setSubscribed).not.toHaveBeenCalled();
    const subscribe = mocks.listeners.get('sub');
    const attachAudio = vi.fn(() => document.createElement('audio'));
    const attachVideo = vi.fn(() => document.createElement('video'));
    subscribe?.({ kind: 'audio', attach: attachAudio }, audio, guest);
    subscribe?.({ kind: 'video', attach: attachVideo }, camera, guest);
    expect(mount.querySelector('audio')).not.toBeNull();
    expect(attachVideo).not.toHaveBeenCalled();
    expect(camera.setSubscribed).toHaveBeenCalledWith(false);
    expect(runtime.video('guest')).toBeUndefined();
    await expect(runtime.camera(true)).rejects.toThrow('Камера отключена');
    await expect(runtime.media.camera(true)).rejects.toThrow('Камера отключена');
    expect(runtime.state.camera).toBe(false);
    expect(mocks.camera).not.toHaveBeenCalled();
    runtime.leave();
  });
  it('disposes stale capture completing after leave and never publishes it', async () => {
    const media = new WidgetMedia(
      document.createElement('div'),
      () => undefined,
      () => undefined
    );
    await media.connect('https://voice.test', 'token');
    let finish: ((value: { track: MediaStreamTrack; dispose: () => void }) => void) | undefined;
    const pending = new Promise<{ track: MediaStreamTrack; dispose: () => void }>((resolve) => {
      finish = resolve;
    });
    mocks.capture.mockReturnValueOnce(pending);
    const changing = media.microphone('', 'rnnoise', false);
    await Promise.resolve();
    media.dispose();
    const dispose = vi.fn();
    if (!finish) throw new Error('Missing capture resolver');
    finish({ track: new FakeTrack(), dispose });
    await changing;
    expect(dispose).toHaveBeenCalledOnce();
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it('volume and mute modify only selected local playback', async () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const media = new WidgetMedia(
      mount,
      () => undefined,
      () => undefined
    );
    await media.connect('https://voice.test', 'token');
    const first = document.createElement('audio');
    const second = document.createElement('audio');
    mocks.listeners.get('sub')?.({ attach: () => first }, {}, { identity: 'peerA' });
    mocks.listeners.get('sub')?.({ attach: () => second }, {}, { identity: 'peerB' });
    media.volume('peerA', 0);
    expect(first.volume).toBe(0);
    expect(second.volume).toBe(1);
    media.volume('peerA', 0.4);
    expect(first.volume).toBe(0.4);
    media.dispose();
    mount.remove();
  });
  it('toggles global output for current and future peers while preserving their local volume levels', async () => {
    const mount = document.createElement('div');
    const runtime = createWidgetRuntime(mount, () => undefined);
    try {
      await runtime.media.connect('https://voice.test', 'token');
      runtime.state.joined = true;
      const first = document.createElement('audio');
      const second = document.createElement('audio');
      const third = document.createElement('audio');
      mocks.listeners.get('sub')?.({ attach: () => first }, {}, { identity: 'quiet' });
      mocks.listeners.get('sub')?.({ attach: () => second }, {}, { identity: 'silenced' });
      runtime.volume('quiet', 0.4);
      runtime.volume('silenced', 0);
      await runtime.toggleOutput();
      expect(runtime.state.outputMuted).toBe(true);
      mocks.listeners.get('sub')?.({ attach: () => third }, {}, { identity: 'late' });
      expect([first, second, third].every((element) => element.muted && element.volume === 0)).toBe(true);
      first.muted = false;
      first.dispatchEvent(new Event('volumechange'));
      expect(first.muted).toBe(true);

      mocks.startAudio.mockImplementationOnce(async () => {
        for (const element of [first, second, third]) element.muted = false;
      });
      await runtime.toggleOutput();
      expect(runtime.state.outputMuted).toBe(false);
      expect(first).toMatchObject({ muted: false, volume: 0.4 });
      expect(second).toMatchObject({ muted: true, volume: 0 });
      expect(third).toMatchObject({ muted: false, volume: 1 });
      expect(mocks.startAudio).toHaveBeenCalledTimes(2);
    } finally {
      runtime.leave();
    }
  });
  it('routes only active cameras to tiles and releases a moved video when LiveKit unsubscribes', async () => {
    const mount = document.createElement('div');
    const tile = document.createElement('div');
    const changed = vi.fn();
    const media = new WidgetMedia(mount, changed, () => undefined);
    await media.connect('https://voice.test', 'token');
    const guest = { identity: 'guest' };
    const audio = document.createElement('audio');
    const video = document.createElement('video');
    const publication = { source: 'camera', isMuted: false };
    const track = { attach: vi.fn(() => video) };
    mocks.listeners.get('sub')?.({ attach: () => audio }, {}, guest);
    mocks.listeners.get('sub')?.(track, publication, guest);
    mocks.listeners.get('sub')?.(track, publication, guest);
    expect(track.attach).toHaveBeenCalledOnce();
    expect(media.video(guest.identity, false)).toBe(video);
    expect(video.playsInline).toBe(true);
    tile.append(video);
    expect(mount.contains(audio)).toBe(true);
    publication.isMuted = true;
    mocks.listeners.get('mute')?.();
    expect(media.video(guest.identity, false)).toBeUndefined();
    publication.isMuted = false;
    mocks.listeners.get('unmute')?.();
    expect(media.video(guest.identity, false)).toBe(video);
    mocks.speakers.push(guest);
    mocks.listeners.get('speakers')?.();
    expect(media.speaking(guest.identity)).toBe(true);
    expect(changed).toHaveBeenCalledTimes(5);
    mocks.listeners.get('unsub')?.(track);
    expect(tile.contains(video)).toBe(false);
    expect(media.video(guest.identity, false)).toBeUndefined();
    expect(mount.contains(audio)).toBe(true);
    media.dispose();
  });
  it('shows one muted local preview and detaches it when the camera is disabled', async () => {
    const media = new WidgetMedia(document.createElement('div'), vi.fn(), () => undefined);
    await media.connect('https://voice.test', 'token');
    const tile = document.createElement('div');
    const track = { attach: vi.fn(), detach: vi.fn() };
    mocks.camera.mockResolvedValue({ videoTrack: track });
    await media.camera(true);
    const video = media.video('self', true);
    if (!video) throw new Error('Missing local camera element');
    tile.append(video);
    expect(video.muted).toBe(true);
    expect(video.autoplay).toBe(true);
    expect(video.playsInline).toBe(true);
    await media.camera(true);
    expect(track.attach).toHaveBeenCalledOnce();
    await media.camera(true, 'camera-two');
    expect(mocks.switchDevice).toHaveBeenCalledWith('videoinput', 'camera-two', true);
    expect(media.video('self', true)).toBe(video);
    await media.camera(false);
    expect(track.detach).toHaveBeenCalledWith(video);
    expect(tile.contains(video)).toBe(false);
    expect(media.video('self', true)).toBeUndefined();
    media.dispose();
  });
  it('stops camera enablement completing after disposal without attaching a stale preview', async () => {
    const media = new WidgetMedia(
      document.createElement('div'),
      () => undefined,
      () => undefined
    );
    await media.connect('https://voice.test', 'token');
    const track = { attach: vi.fn(), stop: vi.fn() };
    let grant: ((publication: { videoTrack: typeof track }) => void) | undefined;
    mocks.camera.mockReturnValueOnce(
      new Promise((resolve) => {
        grant = resolve;
      })
    );
    const operation = media.camera(true);
    await vi.waitFor(() => expect(mocks.camera).toHaveBeenCalledWith(true, undefined));
    media.dispose();
    if (!grant) throw new Error('Missing camera resolver');
    grant({ videoTrack: track });
    await operation;
    expect(track.attach).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(media.video('self', true)).toBeUndefined();
  });
  it('ignores late media publication events after disposal', async () => {
    const mount = document.createElement('div');
    const media = new WidgetMedia(
      mount,
      () => undefined,
      () => undefined
    );
    await media.connect('https://voice.test', 'token');
    const attach = vi.fn(() => document.createElement('audio'));
    media.dispose();
    mocks.listeners.get('sub')?.({ attach }, {}, { identity: 'stalePeer' });
    expect(attach).not.toHaveBeenCalled();
    expect(mount.children).toHaveLength(0);
  });
  it('keeps a later mute choice when an earlier device capture finishes', async () => {
    const media = new WidgetMedia(
      document.createElement('div'),
      () => undefined,
      () => undefined
    );
    await media.connect('https://voice.test', 'token');
    let finish: ((capture: { track: MediaStreamTrack; dispose(): void }) => void) | undefined;
    mocks.capture.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const pending = media.microphone('input', 'browser', false);
    await Promise.resolve();
    media.mute(true);
    const track = new FakeTrack();
    if (!finish) throw new Error('Capture not started');
    finish({ track, dispose: vi.fn() });
    await pending;
    expect(track.enabled).toBe(false);
    media.dispose();
  });
  it('applies later mute immediately while publication is pending and after commit', async () => {
    const media = new WidgetMedia(
      document.createElement('div'),
      () => undefined,
      () => undefined
    );
    await media.connect('https://voice.test', 'token');
    const track = new FakeTrack();
    mocks.capture.mockResolvedValueOnce({ track, dispose: vi.fn() });
    let publish: (() => void) | undefined;
    mocks.publish.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        publish = resolve;
      })
    );
    const pending = media.microphone('input', 'browser', false);
    await vi.waitFor(() => expect(mocks.publish).toHaveBeenCalledOnce());
    media.mute(true);
    expect(track.enabled).toBe(false);
    if (!publish) throw new Error('Publish not started');
    publish();
    await pending;
    expect(track.enabled).toBe(false);
    media.dispose();
  });
  it('switches devices and replaces processing without retaining old capture', async () => {
    const media = new WidgetMedia(
      document.createElement('div'),
      () => undefined,
      () => undefined
    );
    await media.connect('https://voice.test', 'token');
    const first = { track: new FakeTrack(), dispose: vi.fn() };
    const second = { track: new FakeTrack(), dispose: vi.fn() };
    mocks.capture.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    await media.microphone('input-one', 'rnnoise', false);
    await media.microphone('input-two', 'browser', true);
    expect(mocks.capture).toHaveBeenNthCalledWith(2, 'input-two', 'browser', expect.any(Function));
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(second.track.enabled).toBe(false);
    media.dispose();
    expect(second.dispose).toHaveBeenCalledOnce();
  });
  it('processor failure reports fallback and disposes replaced processing', async () => {
    const failure = vi.fn();
    const media = new WidgetMedia(document.createElement('div'), () => undefined, failure);
    await media.connect('https://voice.test', 'token');
    const first = { track: new FakeTrack(), dispose: vi.fn() };
    const second = { track: new FakeTrack(), dispose: vi.fn() };
    let processorError: (() => void) | undefined;
    mocks.capture
      .mockImplementationOnce(async (_device: string, _mode: string, error: () => void) => {
        processorError = error;
        return first;
      })
      .mockResolvedValueOnce(second);
    await media.microphone('input', 'rnnoise', false);
    if (!processorError) throw new Error('Missing processor error handler');
    processorError();
    await vi.waitFor(() => expect(first.dispose).toHaveBeenCalledOnce());
    expect(failure).toHaveBeenCalledWith('RNNoise остановился: включено браузерное шумоподавление', true);
    expect(mocks.capture).toHaveBeenLastCalledWith('input', 'browser', expect.any(Function));
    media.dispose();
    expect(second.dispose).toHaveBeenCalledOnce();
  });
  it('output switching targets existing and subsequent media while unsupported browsers fail clearly', async () => {
    const media = new WidgetMedia(
      document.createElement('div'),
      () => undefined,
      () => undefined
    );
    await expect(media.outputDevice('speaker')).rejects.toThrow('не поддерживает');
    const sink = vi.fn(async () => undefined);
    Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', { configurable: true, value: sink });
    try {
      await media.connect('https://voice.test', 'token');
      const audio = document.createElement('audio');
      mocks.listeners.get('sub')?.({ attach: () => audio }, {}, { identity: 'remote' });
      await media.outputDevice('speaker');
      expect(sink).toHaveBeenCalledWith('speaker');
      const other = document.createElement('audio');
      mocks.listeners.get('sub')?.({ attach: () => other }, {}, { identity: 'other' });
      expect(sink).toHaveBeenCalledTimes(2);
    } finally {
      Reflect.deleteProperty(HTMLMediaElement.prototype, 'setSinkId');
      media.dispose();
    }
  });
  it('autoplay refusal preserves media connection and reports the recovery action', async () => {
    mocks.startAudio
      .mockImplementationOnce(async () => {
        mocks.canPlaybackAudio = false;
        mocks.listeners.get('playback')?.(false);
        throw new Error('Autoplay denied');
      })
      .mockImplementationOnce(async () => {
        mocks.canPlaybackAudio = true;
        mocks.listeners.get('playback')?.(true);
      });
    const runtime = createWidgetRuntime(document.createElement('div'), () => undefined);
    try {
      await runtime.media.connect('https://voice.test', 'token');
      runtime.state.joined = true;
      expect(runtime.outputBlocked()).toBe(true);
      expect(runtime.state.audioRevision).toBe(1);
      expect(runtime.state.error).toBe('Браузер отключил звук. Нажмите «Включить звук».');
      expect(mocks.disconnect).not.toHaveBeenCalled();
      await runtime.toggleOutput();
      expect(runtime.outputBlocked()).toBe(false);
      expect(runtime.state.audioRevision).toBe(2);
      expect(runtime.state.outputMuted).toBe(false);
      expect(runtime.state.error).toBe('');
      expect(mocks.startAudio).toHaveBeenCalledTimes(2);
    } finally {
      runtime.leave();
    }
  });
  it('new participant output-device errors are visible rather than silently ignored', async () => {
    const failure = vi.fn();
    const sink = vi.fn(async () => {
      throw new Error('Output revoked');
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', { configurable: true, value: sink });
    const media = new WidgetMedia(document.createElement('div'), () => undefined, failure);
    try {
      await media.connect('https://voice.test', 'token');
      await media.outputDevice('selected');
      mocks.listeners.get('sub')?.({ attach: () => document.createElement('audio') }, {}, { identity: 'peer' });
      await vi.waitFor(() =>
        expect(failure).toHaveBeenCalledWith('Не удалось выбрать устройство вывода для участника', false)
      );
    } finally {
      Reflect.deleteProperty(HTMLMediaElement.prototype, 'setSinkId');
      media.dispose();
    }
  });
  it('reports exhausted SDK disconnection to its runtime owner and ignores disposal events', async () => {
    const failure = vi.fn();
    const media = new WidgetMedia(document.createElement('div'), () => undefined, failure);
    await media.connect('https://voice.test', 'token');
    mocks.listeners.get('disconnected')?.();
    expect(failure).toHaveBeenCalledWith('Связь с голосовым сервером потеряна. Переподключение…', false, true);
    media.dispose();
    mocks.listeners.get('disconnected')?.();
    expect(failure).toHaveBeenCalledOnce();
  });
  it('readmits media on a replacement transport while an old token request is unresolved', async () => {
    const sockets: FakeSocket[] = [];
    class FakeSocket {
      static OPEN = 1;
      readyState = 1;
      send = vi.fn<(serialized: string) => void>();
      close = vi.fn();
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      constructor() {
        sockets.push(this);
      }
    }
    let rejectOld: ((error: Error) => void) | undefined;
    let tokenRequests = 0;
    const oldToken = new Promise<Response>((_resolve, reject) => {
      rejectOld = reject;
    });
    const request = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const requestPath = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (requestPath.includes('livekit-token')) {
        tokenRequests++;
        if (tokenRequests === 1) return oldToken;
        return new Response(
          JSON.stringify({
            ok: true,
            gateCredentialId: 'gate',
            room: 'media-room',
            token: 'token',
            ttlSeconds: 60,
            url: 'wss://voice.test'
          })
        );
      }
      return new Response(JSON.stringify({ ok: true, roomId: 'roomCode', chat: false, maxRoomPeers: 8, peers: 0 }));
    });
    const snapshot = JSON.stringify({
      type: 'room.snapshot',
      payload: {
        roomId: 'roomCode',
        room: {
          roomId: 'roomCode',
          name: 'Room',
          avatarUrl: null,
          createdAt: 1,
          isStatic: false,
          peers: 1,
          relationship: 'member'
        },
        peers: [],
        recentMessages: [],
        voiceActiveSince: null,
        mode: 'active'
      }
    });
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('fetch', request);
    mocks.capture.mockResolvedValue({ track: new FakeTrack(), dispose: vi.fn() });
    const runtime = createWidgetRuntime(document.createElement('div'), () => undefined);
    try {
      await runtime.join('roomCode');
      const first = sockets[0];
      if (!first) throw new Error('Missing initial socket');
      first.onopen?.();
      first.onmessage?.({ data: snapshot });
      await vi.waitFor(() => expect(tokenRequests).toBe(1));
      vi.useFakeTimers();
      first.onclose?.();
      await vi.advanceTimersByTimeAsync(1000);
      const next = sockets[1];
      if (!next) throw new Error('Missing replacement socket');
      next.onopen?.();
      next.onmessage?.({ data: snapshot });
      await vi.waitFor(() => expect(tokenRequests).toBe(2));
      if (!rejectOld) throw new Error('Missing old token rejection');
      rejectOld(new Error('Old request failed'));
      await vi.advanceTimersByTimeAsync(0);
      await vi.waitFor(() => expect(runtime.state.joined).toBe(true));
      expect(runtime.state.error).not.toBe('Old request failed');
      for (let attempt = 0; attempt < 2; attempt++) {
        const current = sockets.at(-1);
        if (!current) throw new Error('Missing recovery socket');
        mocks.listeners.get('disconnected')?.();
        expect(runtime.state.joined).toBe(false);
        expect(current.close).toHaveBeenCalledOnce();
        current.onclose?.();
        await vi.advanceTimersByTimeAsync(1000);
        const replacement = sockets.at(-1);
        if (!replacement || replacement === current) throw new Error('No bounded replacement');
        replacement.onopen?.();
        replacement.onmessage?.({ data: snapshot });
        await vi.waitFor(() => expect(runtime.state.joined).toBe(true));
      }
      mocks.listeners.get('disconnected')?.();
      expect(runtime.state.joined).toBe(false);
      expect(runtime.state.error).toContain('Связь с голосовым сервером потеряна');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      runtime.leave();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
  it('owns heartbeat timers through join and explicit leave', async () => {
    const sockets: FakeSocket[] = [];
    class FakeSocket {
      static OPEN = 1;
      readyState = 1;
      send = vi.fn<(serialized: string) => void>();
      close = vi.fn();
      onopen: (() => void) | null = null;
      constructor() {
        sockets.push(this);
      }
    }
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true, roomId: 'roomCode', chat: false, maxRoomPeers: 8, peers: 0 }))
      )
    );
    const runtime = createWidgetRuntime(document.createElement('div'), () => undefined);
    await runtime.join('roomCode');
    const socket = sockets[0];
    if (!socket) throw new Error('Missing socket');
    vi.useFakeTimers();
    try {
      socket.onopen?.();
      vi.advanceTimersByTime(15000);
      expect(
        socket.send.mock.calls.some(([serialized]) => {
          const value: unknown = JSON.parse(String(serialized));
          return typeof value === 'object' && value !== null && 'type' in value && value.type === 'ping';
        })
      ).toBe(true);
      runtime.leave();
      const count = socket.send.mock.calls.length;
      vi.advanceTimersByTime(45000);
      expect(socket.send).toHaveBeenCalledTimes(count);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      runtime.leave();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
  it('leave invalidates pending lookup without opening a socket', async () => {
    let finish: ((response: Response) => void) | undefined;
    const pending = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => pending)
    );
    const webSocket = Object.assign(vi.fn(), { OPEN: 1 });
    vi.stubGlobal('WebSocket', webSocket);
    const runtime = createWidgetRuntime(document.createElement('div'), () => undefined);
    const joining = runtime.join('roomCode');
    runtime.leave();
    if (!finish) throw new Error('Missing lookup resolver');
    finish(new Response(JSON.stringify({ ok: true, roomId: 'roomCode', chat: false, maxRoomPeers: 8, peers: 0 })));
    await joining;
    expect(webSocket).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
