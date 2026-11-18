import { loadLiveKitClient } from '../room/client/media/livekit-runtime';
import { openWidgetMicrophone, type WidgetCapture, type WidgetNoiseMode } from './capture';
import type {
  ConnectionQuality,
  LocalVideoTrack,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  Room
} from 'livekit-client';

export const WIDGET_AUDIO_BLOCKED_MESSAGE = 'Браузер отключил звук. Нажмите «Включить звук».';

export class WidgetMedia {
  private room: Room | null = null;
  private quality: `${ConnectionQuality}` = 'unknown';
  private capture: WidgetCapture | null = null;
  private pendingTrack: MediaStreamTrack | null = null;
  private pendingDispose: (() => void) | null = null;
  private generation = 0;
  private microphoneGeneration = 0;
  private microphoneQueue: Promise<void> = Promise.resolve();
  private cameraGeneration = 0;
  private cameraDevice = '';
  private cameraQueue: Promise<void> = Promise.resolve();
  private localCamera: { track: LocalVideoTrack; element: HTMLVideoElement } | undefined;
  private readonly remoteTracks = new Map<
    RemoteTrack,
    { peer: string; element: HTMLMediaElement; camera: RemoteTrackPublication | undefined }
  >();
  private readonly volumes = new Map<string, number>();
  private desiredMuted = false;
  private outputMuted = false;
  private output = '';
  constructor(
    private readonly mount: HTMLElement,
    private readonly changed: () => void,
    private readonly failure: (message: string, noiseFallback: boolean, terminal?: boolean) => void,
    private readonly cameraAllowed = true
  ) {}
  async connect(url: string, token: string): Promise<void> {
    const revision = ++this.generation;
    const sdk = await loadLiveKitClient();
    if (revision !== this.generation) return;
    const room = new sdk.Room({ adaptiveStream: true, dynacast: true });
    this.room = room;
    room.on(sdk.RoomEvent.TrackSubscribed, (track: RemoteTrack, publication, participant: RemoteParticipant) => {
      if (revision !== this.generation || this.room !== room || this.remoteTracks.has(track)) return;
      if (!this.cameraAllowed && track.kind !== sdk.Track.Kind.Audio) {
        publication.setSubscribed(false);
        return;
      }
      const element = track.attach();
      element.autoplay = true;
      if (element instanceof HTMLVideoElement) element.playsInline = true;
      const peer = participant.identity;
      // LiveKit can unmute attached audio on playback recovery, including when iOS regains visibility.
      element.onvolumechange = () => this.syncRemoteVolume(peer, element);
      this.syncRemoteVolume(peer, element);
      this.mount.append(element);
      const camera = publication.source === sdk.Track.Source.Camera ? publication : undefined;
      this.remoteTracks.set(track, { peer, element, camera });
      if (this.output && 'setSinkId' in element)
        void element
          .setSinkId(this.output)
          .catch(() => this.failure('Не удалось выбрать устройство вывода для участника', false));
      this.changed();
    });
    room.on(sdk.RoomEvent.Disconnected, () => {
      if (revision !== this.generation || this.room !== room) return;
      this.failure('Связь с голосовым сервером потеряна. Переподключение…', false, true);
    });
    room.on(sdk.RoomEvent.TrackUnsubscribed, (track) => {
      if (revision !== this.generation || this.room !== room) return;
      // The SDK detaches the track before notifying listeners. Remove the node even if it moved into a tile.
      const entry = this.remoteTracks.get(track);
      if (entry) this.releaseRemoteElement(entry.element);
      this.remoteTracks.delete(track);
      this.changed();
    });
    const refresh = () => {
      if (revision === this.generation && this.room === room) this.changed();
    };
    room.on(sdk.RoomEvent.TrackMuted, refresh);
    room.on(sdk.RoomEvent.TrackUnmuted, refresh);
    room.on(sdk.RoomEvent.ActiveSpeakersChanged, refresh);
    room.on(sdk.RoomEvent.AudioPlaybackStatusChanged, refresh);
    const refreshQuality = () => {
      if (revision !== this.generation || this.room !== room) return;
      this.quality = room.state === sdk.ConnectionState.Connected ? room.localParticipant.connectionQuality : 'unknown';
      this.changed();
    };
    room.on(sdk.RoomEvent.ConnectionStateChanged, refreshQuality);
    room.on(sdk.RoomEvent.ConnectionQualityChanged, (_quality, participant) => {
      if (participant === room.localParticipant) refreshQuality();
    });
    const subscribeAudio = (publication: RemoteTrackPublication) => {
      if (
        revision === this.generation &&
        this.room === room &&
        publication.kind === sdk.Track.Kind.Audio &&
        !publication.isDesired
      ) {
        publication.setSubscribed(true);
      }
    };
    if (!this.cameraAllowed) room.on(sdk.RoomEvent.TrackPublished, subscribeAudio);
    try {
      await room.connect(url, token, { autoSubscribe: this.cameraAllowed });
    } catch (error) {
      await room.disconnect();
      if (this.room === room) this.room = null;
      throw error;
    }
    if (revision !== this.generation) {
      await room.disconnect();
      return;
    }
    if (!this.cameraAllowed) {
      for (const participant of room.remoteParticipants.values()) {
        for (const publication of participant.audioTrackPublications.values()) subscribeAudio(publication);
      }
    }
    if (!this.outputMuted)
      await this.resumeAudio().catch(() => {
        if (revision === this.generation && this.room === room) this.failure(WIDGET_AUDIO_BLOCKED_MESSAGE, false);
      });
  }
  microphone(device: string, mode: WidgetNoiseMode, muted: boolean): Promise<void> {
    this.desiredMuted = muted;
    const revision = ++this.microphoneGeneration;
    const operation = this.microphoneQueue.then(async () => {
      if (revision === this.microphoneGeneration) await this.replaceMicrophone(device, mode, muted, revision);
    });
    this.microphoneQueue = operation.catch(() => undefined);
    return operation;
  }
  private async replaceMicrophone(
    device: string,
    mode: WidgetNoiseMode,
    muted: boolean,
    captureRevision: number
  ): Promise<void> {
    const room = this.room;
    if (!room) throw new Error('Сначала войдите в комнату');
    const revision = this.generation;
    let next: WidgetCapture;
    try {
      next = await openWidgetMicrophone(device, mode, () => {
        if (revision !== this.generation || captureRevision !== this.microphoneGeneration) return;
        this.failure('RNNoise остановился: включено браузерное шумоподавление', true);
        void this.microphone(device, 'browser', this.desiredMuted).catch((error: unknown) =>
          this.failure(error instanceof Error ? error.message : 'Микрофон недоступен', false)
        );
      });
    } catch (error) {
      if (mode !== 'rnnoise' || revision !== this.generation || captureRevision !== this.microphoneGeneration)
        throw error;
      this.failure('RNNoise недоступен: включено браузерное шумоподавление', true);
      return this.replaceMicrophone(device, 'browser', muted, captureRevision);
    }
    if (revision !== this.generation || captureRevision !== this.microphoneGeneration) {
      next.dispose();
      return;
    }
    next.track.enabled = !this.desiredMuted;
    let discarded = false;
    const discard = () => {
      if (discarded) return;
      discarded = true;
      next.dispose();
      if (this.pendingTrack === next.track) {
        this.pendingTrack = null;
        this.pendingDispose = null;
      }
    };
    this.pendingTrack = next.track;
    this.pendingDispose = discard;
    try {
      const previous = this.capture;
      if (previous) await room.localParticipant.unpublishTrack(previous.track, false);
      previous?.dispose();
      if (this.capture === previous) this.capture = null;
      const sdk = await loadLiveKitClient();
      if (revision !== this.generation || captureRevision !== this.microphoneGeneration) {
        discard();
        return;
      }
      await room.localParticipant.publishTrack(next.track, {
        source: sdk.Track.Source.Microphone
      });
      if (revision !== this.generation || captureRevision !== this.microphoneGeneration) {
        await room.localParticipant.unpublishTrack(next.track, false);
        discard();
        return;
      }
      next.track.enabled = !this.desiredMuted;
      this.pendingTrack = null;
      this.pendingDispose = null;
      this.capture = next;
    } catch (error) {
      discard();
      throw error;
    }
  }
  mute(muted: boolean): void {
    this.desiredMuted = muted;
    if (this.pendingTrack) this.pendingTrack.enabled = !muted;
    if (this.capture) this.capture.track.enabled = !muted;
  }
  camera(enabled: boolean, deviceId = ''): Promise<void> {
    if (!this.cameraAllowed) {
      return enabled ? Promise.reject(new Error('Камера отключена для этого виджета')) : Promise.resolve();
    }
    const room = this.room;
    const revision = ++this.cameraGeneration;
    const operation = this.cameraQueue.then(async () => {
      if (!room || this.room !== room || revision !== this.cameraGeneration) return;
      if (enabled && deviceId !== this.cameraDevice && room.localParticipant.videoTrackPublications.size) {
        const switched = await room.switchActiveDevice('videoinput', deviceId || 'default', Boolean(deviceId));
        if (this.room !== room || revision !== this.cameraGeneration) return;
        if (!switched) throw new Error('Не удалось выбрать камеру');
      }
      const publication = await room.localParticipant.setCameraEnabled(enabled, deviceId ? { deviceId } : undefined);
      if (this.room !== room) {
        if (enabled) publication?.videoTrack?.stop();
        return;
      }
      if (revision !== this.cameraGeneration) return;
      const track = enabled ? publication?.videoTrack : undefined;
      if (enabled && !track) throw new Error('Камера недоступна');
      if (enabled) this.cameraDevice = deviceId;
      if (track === this.localCamera?.track) return;
      this.detachLocalCamera();
      if (track) {
        const element = document.createElement('video');
        element.muted = true;
        element.playsInline = true;
        element.autoplay = true;
        track.attach(element);
        this.localCamera = { track, element };
      }
      this.changed();
    });
    this.cameraQueue = operation.catch(() => undefined);
    return operation;
  }
  video(peer: string, self: boolean): HTMLVideoElement | undefined {
    if (!this.cameraAllowed) return undefined;
    if (self) return this.localCamera?.track.isMuted ? undefined : this.localCamera?.element;
    for (const entry of this.remoteTracks.values()) {
      if (entry.peer === peer && entry.camera && !entry.camera.isMuted && entry.element instanceof HTMLVideoElement)
        return entry.element;
    }
    return undefined;
  }
  speaking(peer: string): boolean {
    return this.room?.activeSpeakers.some(({ identity }) => identity === peer) ?? false;
  }
  connectionQuality(): `${ConnectionQuality}` {
    return this.quality;
  }
  private detachLocalCamera(): void {
    const camera = this.localCamera;
    if (!camera) return;
    this.localCamera = undefined;
    camera.track.detach(camera.element);
    camera.element.remove();
  }
  volume(peer: string, value: number): void {
    const volume = Math.max(0, Math.min(1, value));
    this.volumes.set(peer, volume);
    for (const entry of this.remoteTracks.values()) if (entry.peer === peer) this.syncRemoteVolume(peer, entry.element);
  }
  private syncRemoteVolume(peer: string, element: HTMLMediaElement): void {
    const volume = this.outputMuted ? 0 : (this.volumes.get(peer) ?? 1);
    element.volume = volume;
    element.muted = volume === 0;
  }
  private releaseRemoteElement(element: HTMLMediaElement): void {
    element.onvolumechange = null;
    element.remove();
  }
  setOutputMuted(muted: boolean): void {
    this.outputMuted = muted;
    this.syncOutputVolume();
  }
  private syncOutputVolume(): void {
    for (const { peer, element } of this.remoteTracks.values()) this.syncRemoteVolume(peer, element);
  }
  outputBlocked(): boolean {
    return this.room?.canPlaybackAudio === false;
  }
  async outputDevice(device: string): Promise<void> {
    if (!('setSinkId' in HTMLMediaElement.prototype))
      throw new Error('Этот браузер не поддерживает выбор устройства вывода');
    for (const { element } of this.remoteTracks.values()) await element.setSinkId(device);
    this.output = device;
  }
  async resumeAudio(): Promise<void> {
    const room = this.room;
    if (!room || this.outputMuted) return;
    const playback = room.startAudio();
    this.syncOutputVolume();
    try {
      await playback;
    } finally {
      if (this.room === room) this.syncOutputVolume();
    }
  }
  dispose(): void {
    this.generation++;
    this.microphoneGeneration++;
    this.cameraGeneration++;
    this.cameraDevice = '';
    this.cameraQueue = Promise.resolve();
    this.pendingDispose?.();
    this.capture?.dispose();
    this.capture = null;
    const room = this.room;
    this.room = null;
    this.quality = 'unknown';
    this.detachLocalCamera();
    if (room) void room.disconnect();
    for (const { element } of this.remoteTracks.values()) this.releaseRemoteElement(element);
    this.remoteTracks.clear();
    this.changed();
  }
}
