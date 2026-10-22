// jsdom has no media capture. These stand-ins implement the browser's media
// interfaces, so a test builds tracks and streams that type as the real ones
// and passes them where the room code expects MediaStream and MediaStreamTrack.
// A track ends with `track.dispatchEvent(new Event('ended'))`. Code under test
// that calls `new MediaStream(...)` itself needs
// `vi.stubGlobal('MediaStream', FakeMediaStream)`.

export class FakeMediaStreamTrack extends EventTarget implements MediaStreamTrack {
  readonly id: string;
  readonly kind: 'audio' | 'video';
  readonly label: string;
  contentHint = '';
  enabled = true;
  muted = false;
  readyState: MediaStreamTrackState = 'live';
  onended: MediaStreamTrack['onended'] = null;
  onmute: MediaStreamTrack['onmute'] = null;
  onunmute: MediaStreamTrack['onunmute'] = null;

  constructor(id: string, kind: 'audio' | 'video', label = '') {
    super();
    this.id = id;
    this.kind = kind;
    this.label = label;
  }

  applyConstraints(): Promise<void> {
    return Promise.resolve();
  }

  clone(): FakeMediaStreamTrack {
    return new FakeMediaStreamTrack(this.id, this.kind, this.label);
  }

  getCapabilities(): MediaTrackCapabilities {
    return {};
  }

  getConstraints(): MediaTrackConstraints {
    return {};
  }

  getSettings(): MediaTrackSettings {
    return {};
  }

  stop(): void {
    this.readyState = 'ended';
  }
}

export class FakeMediaStream extends EventTarget implements MediaStream {
  readonly id: string;
  onaddtrack: MediaStream['onaddtrack'] = null;
  onremovetrack: MediaStream['onremovetrack'] = null;
  #tracks: MediaStreamTrack[];

  constructor(tracks: readonly MediaStreamTrack[] = [], id = 'fake-stream') {
    super();
    this.#tracks = [...tracks];
    this.id = id;
  }

  get active(): boolean {
    return this.#tracks.some((track) => track.readyState === 'live');
  }

  addTrack(track: MediaStreamTrack): void {
    if (!this.#tracks.includes(track)) this.#tracks.push(track);
  }

  removeTrack(track: MediaStreamTrack): void {
    this.#tracks = this.#tracks.filter((candidate) => candidate !== track);
  }

  clone(): FakeMediaStream {
    return new FakeMediaStream(this.#tracks, this.id);
  }

  getTrackById(trackId: string): MediaStreamTrack | null {
    return this.#tracks.find((track) => track.id === trackId) ?? null;
  }

  getTracks(): MediaStreamTrack[] {
    return [...this.#tracks];
  }

  getAudioTracks(): MediaStreamTrack[] {
    return this.#tracks.filter((track) => track.kind === 'audio');
  }

  getVideoTracks(): MediaStreamTrack[] {
    return this.#tracks.filter((track) => track.kind === 'video');
  }
}
