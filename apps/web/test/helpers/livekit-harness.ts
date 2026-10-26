// Loads the real livekit-service with its collaborators replaced by small
// fakes, so tests can drive LiveKit participants and publications directly.
// Each call gives a fresh module graph and fresh fakes.

import type { RoomOptions } from 'livekit-client';
import { vi } from 'vitest';
import type { Participant } from '../../src/lib/features/room/client/core/types.ts';
import type * as LiveKitServiceModule from '../../src/lib/features/room/client/services/livekit-service.ts';

type Peer = Record<string, unknown> & { id: string };

export interface LiveKitHarness {
  service: typeof LiveKitServiceModule;
  state: {
    outputMuted: boolean;
    peerId: string;
    peers: Map<string, Peer>;
    screenSubscribedPeerIds: Set<string>;
    serverPeerIds: Set<string>;
    serverPeerSyncReady: boolean;
    viewedScreenPeerId: string;
    livekitRoom?: { remoteParticipants?: Map<string, unknown>; [key: string]: unknown } | null;
    self?: Peer | null;
    [key: string]: unknown;
  };
  /** Pending loadLiveKitClient() calls; call one to resolve it. */
  livekitClientResolvers: Array<() => void>;
  screenAttachments: Array<{ peer: Peer; stream: unknown }>;
  detachedScreens: string[];
  retries: { scheduled: Array<{ key: string }>; cleared: number; clearedAll: number };
  audio: { ensured: Array<{ peerId: string }> };
  /** Every toast the service showed, in order. */
  toasts: string[];
  /** A refusal from the API as the real client raises it. */
  refusal(message: string, code: string, status?: number): Error;
  /**
   * Hands a fake remote participant to the service the way LiveKit holds it:
   * in the room's participant list, synced by its identity.
   */
  syncParticipant(participant: { identity: string }): Participant | null;
  /** Every LiveKit Room the service created, in order. */
  rooms: Array<{
    /** Handlers the service bound, by RoomEvent name. */
    listeners: Map<string, Array<(...args: unknown[]) => void>>;
    /** What the service passed to `new Room()`. */
    roomOptions: RoomOptions;
    connectedUrl: string;
    connectOptions: Record<string, unknown>;
    disconnected: boolean;
    published: Array<{ track: unknown; options: Record<string, unknown> }>;
    unpublished: unknown[];
    /** Calls the handlers bound to a RoomEvent, as LiveKit does. */
    emit(event: string, ...args: unknown[]): void;
  }>;
}

const P = '../../src/lib/features/room/client';

export async function loadLiveKitHarness(
  options: {
    autoResolveClient?: boolean;
    /** Answers the LiveKit token request. */
    requestToken?: () => Promise<{ token: string; url?: string; urls?: string[] }>;
    /** LiveKit URLs whose connect() fails. */
    failingUrls?: string[];
    /** What the raw-microphone silence check answers. */
    inputSilent?: () => Promise<boolean>;
    /** Whether a recovery epoch is still current. */
    recoveryEpochCurrent?: () => boolean;
    /** The codec this browser would send a camera in. */
    cameraCodec?: 'h264' | 'vp8';
  } = {}
): Promise<LiveKitHarness> {
  vi.resetModules();

  const state: LiveKitHarness['state'] = {
    outputMuted: false,
    peerId: 'self',
    peers: new Map(),
    screenSubscribedPeerIds: new Set(),
    serverPeerIds: new Set(),
    serverPeerSyncReady: false,
    viewedScreenPeerId: ''
  };
  const livekitClientResolvers: Array<() => void> = [];
  const screenAttachments: LiveKitHarness['screenAttachments'] = [];
  const detachedScreens: string[] = [];
  const retries: LiveKitHarness['retries'] = { scheduled: [], cleared: 0, clearedAll: 0 };
  const audio: LiveKitHarness['audio'] = { ensured: [] };
  const toasts: string[] = [];
  const rooms: FakeRoom[] = [];
  const failingUrls = new Set<string>(options.failingUrls ?? []);
  class FakeRoom {
    readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    readonly remoteParticipants = new Map<string, unknown>();
    connectedUrl = '';
    connectOptions: Record<string, unknown> = {};
    disconnected = false;
    readonly published: Array<{ track: unknown; options: Record<string, unknown> }> = [];
    readonly unpublished: unknown[] = [];
    readonly localParticipant = {
      trackPublications: new Map<string, unknown>(),
      publishTrack: async (track: unknown, publishOptions: Record<string, unknown>) => {
        this.published.push({ track, options: publishOptions });
        return {
          track,
          trackSid: `sid-${this.published.length}`,
          source: publishOptions.source,
          mute: async () => {},
          unmute: async () => {}
        };
      },
      unpublishTrack: async (track: unknown) => {
        this.unpublished.push(track);
      }
    };
    constructor(readonly roomOptions: RoomOptions = {}) {
      rooms.push(this);
    }
    async connect(url: string, _token: string, connectOptions: Record<string, unknown> = {}) {
      if (failingUrls.has(url)) throw new Error(`cannot reach ${url}`);
      this.connectedUrl = url;
      this.connectOptions = connectOptions;
    }
    on(event: string, handler: (...args: unknown[]) => void) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), handler]);
      return this;
    }
    emit(event: string, ...args: unknown[]) {
      for (const handler of this.listeners.get(event) ?? []) handler(...args);
    }
    removeAllListeners() {
      this.listeners.clear();
    }
    async disconnect() {
      this.disconnected = true;
    }
  }
  const RoomEvent = new Proxy({}, { get: (_target, name) => String(name) });
  const livekitClient = {
    Room: FakeRoom,
    RoomEvent,
    SubscriptionError: { SE_CODEC_UNSUPPORTED: 1 },
    // The same values as the TRACK_SOURCE fake below, so published tracks read back as their kind.
    Track: {
      Source: {
        Camera: 'camera',
        Microphone: 'microphone',
        ScreenShare: 'screen-video',
        ScreenShareAudio: 'screen-audio'
      }
    },
    VideoQuality: { HIGH: 2, MEDIUM: 1, LOW: 0 },
    VideoPresets: { h180: { resolution: { height: 180 } }, h360: { resolution: { height: 360 } } },
    VideoPreset: class {
      readonly args: unknown[];
      constructor(...args: unknown[]) {
        this.args = args;
      }
    }
  };

  vi.doMock('../../src/lib/features/room/start-ui.svelte', () => ({ startUi: {} }));
  vi.doMock(`${P}/core/state.svelte`, () => ({ state }));
  vi.doMock(`${P}/ui/status`, () => ({ setVoiceConnectionStatus: () => {} }));
  vi.doMock(`${P}/ui/toast`, () => ({
    showToast: (message: string) => {
      toasts.push(message);
    }
  }));
  vi.doMock(`${P}/media/input-silence`, () => ({
    isMicrophoneInputSilent: options.inputSilent ?? (async () => false)
  }));
  const { ApiError } = await import('../../src/lib/api/client.ts');
  vi.doMock(`${P}/net/api`, () => ({
    requestLiveKitToken: options.requestToken ?? (async () => ({}))
  }));
  vi.doMock(`${P}/services/media-playback-service`, () => ({
    queueAudioUnlock: () => {},
    syncRemoteAudioPlayback: () => {}
  }));
  vi.doMock(`${P}/media/cues`, () => ({ clearPeerJoinCue: () => {} }));
  vi.doMock(`${P}/media/profiles`, () => ({
    getPreferredCameraVideoCodec: () => options.cameraCodec ?? 'h264',
    getScreenProfile: () => ({ id: 'balanced-30' }),
    getScreenPublishVideoOptions: () => ({})
  }));
  vi.doMock(`${P}/media/livekit-runtime`, () => ({
    TRACK_SOURCE: {
      Camera: 'camera',
      Microphone: 'microphone',
      ScreenShare: 'screen-video',
      ScreenShareAudio: 'screen-audio'
    },
    loadLiveKitClient: () =>
      options.autoResolveClient
        ? Promise.resolve(livekitClient)
        : new Promise((resolve) => {
            livekitClientResolvers.push(() => resolve(livekitClient));
          })
  }));
  vi.doMock(`${P}/media/screen-subscription-retry`, () => ({
    createScreenSubscriptionRetryController: () => ({
      clear: () => {
        retries.cleared += 1;
      },
      clearAll: () => {
        retries.clearedAll += 1;
      },
      schedule: (input: { key: string }) => {
        retries.scheduled.push(input);
      }
    })
  }));
  vi.doMock(`${P}/room/participants`, () => ({
    createParticipant: (peerInfo: Peer) => {
      const existing = state.peers.get(peerInfo.id);
      if (existing) {
        if (Object.hasOwn(peerInfo, 'screen') && existing.screenAuthoritative !== false)
          existing.screen = Boolean(peerInfo.screen);
        if (Object.hasOwn(peerInfo, 'screenAudio') && existing.screenAuthoritative !== false)
          existing.screenAudio = Boolean(peerInfo.screenAudio);
        return existing;
      }
      const peer = { ...peerInfo, screen: Boolean(peerInfo.screen), screenAudio: Boolean(peerInfo.screenAudio) };
      state.peers.set(peer.id, peer);
      return peer;
    },
    applyRemoteScreenCue: () => {},
    attachRemoteScreenStream: (peer: Peer, stream: unknown) => {
      screenAttachments.push({ peer, stream });
      peer.screen = true;
      peer.screenStream = stream;
    },
    attachRemoteTrack: () => {},
    ensureRemoteAudioElement: (peer: Peer) => {
      audio.ensured.push({ peerId: peer.id });
      return null;
    },
    detachLiveKitParticipant: () => {},
    detachRemoteAudioTrack: () => {},
    detachRemoteScreen: (peer: Peer) => {
      detachedScreens.push(peer.id);
      peer.screen = false;
      peer.screenAudio = false;
      peer.screenStream = null;
    },
    detachRemoteScreenAudioTrack: () => {},
    detachRemoteScreenVideoTrack: () => {},
    detachRemoteScreenVideoTracks: () => {},
    removePeer: () => {},
    setParticipantSpeaking: () => {},
    updateParticipant: () => {},
    updatePeerStatus: () => {}
  }));
  vi.doMock(`${P}/ui/screen-view`, () => ({
    refreshScreenStage: () => {},
    refreshScreenTiles: () => {}
  }));
  vi.doMock(`${P}/recovery/room-recovery`, () => ({
    isCurrentRoomRecoveryEpoch: () => options.recoveryEpochCurrent?.() ?? true,
    notifyLiveKitDisconnected: () => {},
    notifyLiveKitReconciled: () => {},
    notifyLiveKitReconnecting: () => {},
    setRoomRecoveryLiveKitAdapter: () => {},
    subscribeRoomRecoveryTransitions: () => () => {}
  }));
  vi.doMock(`${P}/core/microphone-mute`, () => ({ isMicrophoneShownMuted: () => state.muted === true }));
  vi.doMock(`${P}/recovery/screen-recovery-grace`, () => ({
    ScreenRecoveryGraceController: class {
      beginGlobal() {}
      cancel() {}
      endGlobal() {}
      schedule() {}
      authoritativeStop() {}
    }
  }));
  vi.doMock(`${P}/recovery/livekit-reconcile-generation`, () => ({
    LiveKitReconcileGeneration: class {
      capture() {
        return 0;
      }
      invalidate() {
        return 1;
      }
      isCurrent() {
        return true;
      }
    }
  }));

  const service = await import('../../src/lib/features/room/client/services/livekit-service.ts');
  return {
    service,
    state,
    livekitClientResolvers,
    screenAttachments,
    detachedScreens,
    retries,
    audio,
    toasts,
    refusal: (message, code, status = 0) => new ApiError(message, status, { code }),
    syncParticipant: (participant) => {
      const room = (state.livekitRoom ??= {});
      (room.remoteParticipants ??= new Map()).set(participant.identity, participant);
      return service.syncLiveKitParticipantById(participant.identity);
    },
    rooms
  };
}

/** A fake remote publication that records subscription and quality requests. */
export function fakePublication(
  source: 'camera' | 'microphone' | 'screen-video' | 'screen-audio',
  extra: Record<string, unknown> = {}
) {
  const calls: { subscribed: boolean[]; quality: unknown[] } = { subscribed: [], quality: [] };
  const publication = {
    source,
    trackSid: `${source}-sid`,
    isMuted: false,
    isDesired: false,
    isSubscribed: false,
    setSubscribed(subscribed: boolean) {
      calls.subscribed.push(subscribed);
      this.isDesired = subscribed;
    },
    setVideoQuality(quality: unknown) {
      calls.quality.push(quality);
    },
    ...extra
  };
  return { publication, calls };
}

export function fakeParticipant(
  identity: string,
  publications: Array<{ trackSid: string; source?: string }>,
  extra: Record<string, unknown> = {}
) {
  return {
    identity,
    isLocal: false,
    isScreenShareEnabled: publications.some((publication) => publication.source === 'screen-video'),
    joinedAt: new Date(0),
    name: identity,
    trackPublications: new Map(publications.map((publication) => [publication.trackSid, publication])),
    ...extra
  };
}

export const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));
