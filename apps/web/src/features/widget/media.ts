import { loadLiveKitClient } from '../room/client/media/livekit-runtime';
import { openWidgetMicrophone, type WidgetCapture, type WidgetNoiseMode } from './capture';
import type { Room, RemoteParticipant, RemoteTrack } from 'livekit-client';
export class WidgetMedia {
  private room: Room | null = null;
  private capture: WidgetCapture | null = null;
  private pendingTrack: MediaStreamTrack | null = null;
  private pendingDispose: (() => void) | null = null;
  private generation = 0;
  private microphoneGeneration = 0;
  private microphoneQueue: Promise<void> = Promise.resolve();
  readonly elements = new Map<string, HTMLMediaElement[]>();
  readonly volumes = new Map<string, number>();
  private desiredMuted = false;
  private output = '';
  constructor(
    private readonly mount: HTMLElement,
    private readonly changed: () => void,
    private readonly failure: (message: string, noiseFallback: boolean, terminal?: boolean) => void
  ) {}
  async connect(url: string, token: string): Promise<void> {
    const revision = ++this.generation;
    const sdk = await loadLiveKitClient();
    if (revision !== this.generation) return;
    const room = new sdk.Room({ adaptiveStream: true, dynacast: true });
    this.room = room;
    room.on(sdk.RoomEvent.TrackSubscribed, (track: RemoteTrack, _publication, participant: RemoteParticipant) => {
      if (revision !== this.generation || this.room !== room) return;
      const element = track.attach();
      element.autoplay = true;
      if (element instanceof HTMLVideoElement) element.playsInline = true;
      this.mount.append(element);
      const elements = this.elements.get(participant.identity) ?? [];
      elements.push(element);
      this.elements.set(participant.identity, elements);
      element.volume = this.volumes.get(participant.identity) ?? 1;
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
      track.detach().forEach((element) => element.remove());
      for (const [peer, elements] of this.elements) {
        const retained = elements.filter((element) => element.isConnected);
        if (retained.length) this.elements.set(peer, retained);
        else this.elements.delete(peer);
      }
      this.changed();
    });
    try {
      await room.connect(url, token);
    } catch (error) {
      await room.disconnect();
      if (this.room === room) this.room = null;
      throw error;
    }
    if (revision !== this.generation) {
      await room.disconnect();
      return;
    }
    await room.startAudio().catch(() => this.failure('Браузер отключил звук. Нажмите «Включить звук».', false));
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
  async camera(enabled: boolean, deviceId = ''): Promise<void> {
    await this.room?.localParticipant.setCameraEnabled(enabled, deviceId ? { deviceId } : undefined);
  }
  volume(peer: string, value: number): void {
    const volume = Math.max(0, Math.min(1, value));
    this.volumes.set(peer, volume);
    for (const element of this.elements.get(peer) ?? []) element.volume = volume;
  }
  async outputDevice(device: string): Promise<void> {
    if (!('setSinkId' in HTMLMediaElement.prototype))
      throw new Error('Этот браузер не поддерживает выбор устройства вывода');
    for (const elements of this.elements.values()) for (const element of elements) await element.setSinkId(device);
    this.output = device;
  }
  async resumeAudio(): Promise<void> {
    await this.room?.startAudio();
  }
  dispose(): void {
    this.generation++;
    this.microphoneGeneration++;
    this.pendingDispose?.();
    this.capture?.dispose();
    this.capture = null;
    const room = this.room;
    this.room = null;
    if (room) void room.disconnect();
    for (const elements of this.elements.values()) elements.forEach((element) => element.remove());
    this.elements.clear();
  }
}
