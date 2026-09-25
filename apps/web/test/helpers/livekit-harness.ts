// Loads the real livekit-service with its collaborators replaced by small
// fakes, so tests can drive LiveKit participants and publications directly.
// Each call gives a fresh module graph and fresh fakes.

import { vi } from 'vitest';
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
    [key: string]: unknown;
  };
  /** Pending loadLiveKitClient() calls; call one to resolve it. */
  livekitClientResolvers: Array<() => void>;
  screenAttachments: Array<{ peer: Peer; stream: unknown }>;
  detachedScreens: string[];
  retries: { scheduled: Array<{ peerId: string }>; cleared: number; clearedAll: number };
  audio: { ensured: Array<{ peerId: string }> };
  /** A refusal from the API as the real client raises it. */
  refusal(message: string, code: string, status?: number): Error;
  /** Every LiveKit Room the service created, in order. */
  rooms: Array<{
    connectedUrl: string;
    connectOptions: Record<string, unknown>;
    disconnected: boolean;
    published: Array<{ track: unknown; options: Record<string, unknown> }>;
    unpublished: unknown[];
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
    /** Whether a recovery epoch is still current. */
    recoveryEpochCurrent?: () => boolean;
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
    constructor() {
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
    VideoQuality: { HIGH: 2, LOW: 0 },
    VideoPreset: class {
      constructor(readonly encoding: unknown) {}
    }
  };

  vi.doMock(`${P}/core/config`, () => ({ MICROPHONE_AUDIO_BITRATE: 64_000, SCREEN_AUDIO_BITRATE: 192_000 }));
  vi.doMock('../../src/lib/features/room/start-ui.svelte', () => ({ startUi: {} }));
  vi.doMock(`${P}/core/state.svelte`, () => ({ state }));
  vi.doMock(`${P}/ui/status`, () => ({ setVoiceConnectionStatus: () => {} }));
  vi.doMock(`${P}/ui/toast`, () => ({ showToast: () => {} }));
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
    getScreenProfile: () => ({ id: 'balanced-30' }),
    getScreenPublishVideoOptions: () => ({})
  }));
  vi.doMock(`${P}/media/livekit-runtime`, () => ({
    TRACK_SOURCE: { Microphone: 'microphone', ScreenShare: 'screen-video', ScreenShareAudio: 'screen-audio' },
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
      schedule: (input: { peerId: string }) => {
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
    refreshParticipantState: () => {},
    removePeer: () => {},
    setParticipantSpeaking: () => {},
    updateParticipant: () => {},
    updatePeerStatus: () => {}
  }));
  vi.doMock(`${P}/ui/screen-view`, () => ({
    refreshScreenAction: () => {},
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
    refusal: (message, code, status = 0) => new ApiError(message, status, { code }),
    rooms
  };
}

/** A fake remote publication that records subscription and quality requests. */
export function fakePublication(
  source: 'microphone' | 'screen-video' | 'screen-audio',
  extra: Record<string, unknown> = {}
) {
  const calls = { subscribed: [] as boolean[], quality: [] as unknown[] };
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
  publications: Array<{ trackSid: string }>,
  extra: Record<string, unknown> = {}
) {
  return {
    identity,
    isLocal: false,
    isScreenShareEnabled: publications.some(
      (publication) => (publication as { source?: string }).source === 'screen-video'
    ),
    joinedAt: new Date(0),
    name: identity,
    trackPublications: new Map(publications.map((publication) => [publication.trackSid, publication])),
    ...extra
  };
}

export const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));
