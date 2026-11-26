// Loads the real livekit-service with its collaborators replaced by small
// fakes, so tests can drive LiveKit participants and publications directly.
// Each call gives a fresh module graph and fresh fakes.

import type { RoomOptions } from 'livekit-client';
import { createPinia, setActivePinia } from 'pinia';
import { vi } from 'vitest';
import { installWebCallPortsForTest } from './call-ports';
import type { Participant } from '@voiceroom/call/engine/core/types';
import type { CallTransport } from '@voiceroom/call/engine/transport';
import type * as LiveKitServiceModule from '@voiceroom/call/engine/services/livekit-service';
import type * as ScreenProfilesModule from '@voiceroom/call/engine/media/profiles';
import type * as ParticipantsModule from '@voiceroom/call/engine/room/participants';

type Peer = Record<string, unknown> & { id: string; audioElements?: Map<string, HTMLAudioElement> };

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
  audio: { ensured: Array<{ peerId: string }>; playbackSyncs: number };
  recovery: { reconciled: number; replacementRequests: number };
  /** Every toast the service showed, in order. */
  toasts: string[];
  voiceStatuses: string[];
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
    localParticipant: { trackPublications: Map<string, unknown> };
    remoteParticipants: Map<string, unknown>;
    activeSpeakers: Array<{ identity: string }>;
    /** Calls the handlers bound to a RoomEvent, as LiveKit does. */
    emit(event: string, ...args: unknown[]): void;
    /** The server ends the session: unless told otherwise, LiveKit stops the tracks the room published. */
    dropByServer(): void;
  }>;
}

const isStoppable = (track: unknown): track is { stop(): void } =>
  typeof track === 'object' && track !== null && 'stop' in track && typeof track.stop === 'function';

const P = '@voiceroom/call/engine';

export async function loadLiveKitHarness(
  options: {
    autoResolveClient?: boolean;
    /** Answers the LiveKit token request. */
    requestToken?: (
      input: Parameters<CallTransport['requestLiveKitToken']>[0]
    ) => Promise<{ token: string; url?: string; urls?: string[] }>;
    /** LiveKit URLs whose connect() fails. */
    failingUrls?: string[];
    /** Runs as a room connects: fills in who is there, or holds its publishing back. */
    onConnect?: (room: { remoteParticipants: Map<string, unknown>; publishGate: Promise<unknown> }) => void;
    /** Holds one selected publication without blocking the microphone published before it. */
    onPublish?: (track: unknown) => Promise<void>;
    /** Holds exact SDK cleanup to verify a stale join cannot affect a newer call. */
    onUnpublish?: (track: unknown) => Promise<void>;
    /** Isolate control-sync presence in media-only tests without an app realtime fake. */
    stubPresence?: boolean;
    /** Exercise real microphone elements, meters and output controls. */
    realVoicePlayback?: boolean;
    /** What the raw-microphone silence check answers. */
    inputSilent?: () => Promise<boolean>;
    /** Whether a recovery epoch is still current. */
    recoveryEpochCurrent?: (epoch: number) => boolean;
    /** Answers a request for a new LiveKit connection; null when none can start. */
    requestReplacement?: () => Promise<boolean> | null;
    /** Resolves when a running recovery is over; null when none is running. */
    recoverySettled?: () => Promise<void> | null;
    /** The codec this browser would send a camera in. */
    cameraCodec?: 'h264' | 'vp8';
  } = {}
): Promise<LiveKitHarness> {
  vi.resetModules();
  setActivePinia(createPinia());
  await installWebCallPortsForTest();

  const state: LiveKitHarness['state'] = {
    outputMuted: false,
    localStream: null,
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
  const audio: LiveKitHarness['audio'] = { ensured: [], playbackSyncs: 0 };
  const recovery = { reconciled: 0, replacementRequests: 0 };
  const toasts: string[] = [];
  const voiceStatuses: string[] = [];
  const rooms: FakeRoom[] = [];
  const failingUrls = new Set<string>(options.failingUrls ?? []);
  class FakeRoom {
    readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    readonly remoteParticipants = new Map<string, unknown>();
    activeSpeakers: Array<{ identity: string }> = [];
    connectedUrl = '';
    connectOptions: Record<string, unknown> = {};
    disconnected = false;
    readonly published: Array<{ track: unknown; options: Record<string, unknown> }> = [];
    readonly unpublished: unknown[] = [];
    publishGate: Promise<unknown> = Promise.resolve();
    readonly localParticipant = {
      trackPublications: new Map<string, unknown>(),
      publishTrack: async (track: unknown, publishOptions: Record<string, unknown>) => {
        await this.publishGate;
        await options.onPublish?.(track);
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
        await options.onUnpublish?.(track);
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
      options.onConnect?.(this);
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
    dropByServer() {
      if (this.roomOptions.stopLocalTrackOnUnpublish !== false) {
        for (const { track } of this.published) if (isStoppable(track)) track.stop();
      }
      this.emit('Disconnected');
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
    getBrowser: () => undefined,
    VideoPresets: { h180: { resolution: { height: 180 } }, h360: { resolution: { height: 360 } } },
    VideoPreset: class {
      readonly args: unknown[];
      constructor(...args: unknown[]) {
        this.args = args;
      }
    }
  };

  vi.doMock('@voiceroom/call/engine/core/start-ui.store', () => ({ useStartUiStore: () => ({}) }));
  vi.doMock(`${P}/core/room-runtime.store`, () => ({ state }));
  // Media-only tests can isolate the network presence edge. Camera tests use
  // their own room-realtime mock to verify real presence payloads.
  if (options.stubPresence) vi.doMock(`${P}/room/presence`, () => ({ postState: vi.fn(async () => {}) }));
  else vi.doUnmock(`${P}/room/presence`);
  vi.doMock(`${P}/ui/status`, () => ({
    setVoiceConnectionStatus: (status: string) => {
      voiceStatuses.push(status);
    }
  }));
  vi.doMock(`${P}/ui/toast`, () => ({
    showToast: (message: string) => {
      toasts.push(message);
    }
  }));
  vi.doMock(`${P}/media/input-silence`, () => ({
    isMicrophoneInputSilent: options.inputSilent ?? (async () => false)
  }));
  const { ApiError } = await import('@/api/client.ts');
  vi.doMock(`${P}/net/api`, () => ({
    requestLiveKitToken: options.requestToken ?? (async () => ({}))
  }));
  if (options.realVoicePlayback) vi.doUnmock(`${P}/services/media-playback-service`);
  else
    vi.doMock(`${P}/services/media-playback-service`, () => ({
      queueAudioUnlock: () => {},
      syncRemoteAudioPlayback: () => {
        audio.playbackSyncs += 1;
      }
    }));
  vi.doMock(`${P}/media/cues`, () => ({ clearPeerJoinCue: () => {}, playOutputCue: () => {} }));
  vi.doMock(`${P}/media/profiles`, async () => {
    const actual = await vi.importActual<typeof ScreenProfilesModule>(`${P}/media/profiles`);
    return {
      ...actual,
      getPreferredCameraVideoCodec: () => options.cameraCodec ?? 'h264',
      getScreenPublishVideoOptions: () => ({})
    };
  });
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
  vi.doMock(`${P}/room/participants`, async () => {
    const actual = options.realVoicePlayback
      ? await vi.importActual<typeof ParticipantsModule>(`${P}/room/participants`)
      : undefined;
    return {
      createParticipant: (peerInfo: Peer) => {
        const existing = state.peers.get(peerInfo.id);
        if (existing) {
          if (Object.hasOwn(peerInfo, 'screen') && existing.screenAuthoritative !== false)
            existing.screen = Boolean(peerInfo.screen);
          if (Object.hasOwn(peerInfo, 'screenAudio') && existing.screenAuthoritative !== false)
            existing.screenAudio = Boolean(peerInfo.screenAudio);
          return existing;
        }
        const peer = {
          ...peerInfo,
          screen: Boolean(peerInfo.screen),
          screenAudio: Boolean(peerInfo.screenAudio),
          ...(actual && { audioElements: new Map<string, HTMLAudioElement>() })
        };
        state.peers.set(peer.id, peer);
        return peer;
      },
      applyRemoteScreenCue: () => {},
      attachRemoteScreenStream: (peer: Peer, stream: unknown) => {
        screenAttachments.push({ peer, stream });
        peer.screen = true;
        peer.screenStream = stream;
      },
      attachRemoteTrack: actual?.attachRemoteTrack ?? (() => {}),
      ensureRemoteAudioElement:
        actual?.ensureRemoteAudioElement ??
        ((peer: Peer) => {
          audio.ensured.push({ peerId: peer.id });
          return null;
        }),
      detachLiveKitParticipant: (peer: Peer) => {
        peer.livekitParticipant = null;
      },
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
      removeAudioElements:
        actual?.removeAudioElements ??
        ((peer: Peer) => {
          peer.audioElements?.clear();
        }),
      clearAllSpeaking: actual?.clearAllSpeaking,
      setParticipantSpeaking: (peer: Peer, speaking: boolean) => {
        peer.speaking = speaking;
      },
      updateParticipant: () => {},
      updatePeerStatus: () => {}
    };
  });
  vi.doMock(`${P}/ui/screen-view`, () => ({
    refreshScreenStage: () => {},
    refreshScreenTiles: () => {},
    syncScreenVideoAudio: () => {}
  }));
  vi.doMock(`${P}/recovery/room-recovery`, () => ({
    isCurrentRoomRecoveryEpoch: (epoch: number) => options.recoveryEpochCurrent?.(epoch) ?? true,
    notifyLiveKitDisconnected: () => {},
    notifyLiveKitReconciled: () => {
      recovery.reconciled += 1;
    },
    notifyLiveKitReconnecting: () => {},
    requestLiveKitReplacement: () => {
      recovery.replacementRequests += 1;
      return options.requestReplacement?.() ?? null;
    },
    roomRecoverySettled: () => options.recoverySettled?.() ?? null,
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

  const service = await import('@voiceroom/call/engine/services/livekit-service');
  return {
    service,
    state,
    livekitClientResolvers,
    screenAttachments,
    detachedScreens,
    retries,
    audio,
    recovery,
    toasts,
    voiceStatuses,
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
  const calls: { subscribed: boolean[]; enabled: boolean[]; quality: unknown[] } = {
    subscribed: [],
    enabled: [],
    quality: []
  };
  const publication = {
    source,
    trackSid: `${source}-sid`,
    isMuted: false,
    isDesired: false,
    isSubscribed: false,
    isEnabled: true,
    setSubscribed(subscribed: boolean) {
      calls.subscribed.push(subscribed);
      this.isDesired = subscribed;
    },
    setEnabled(enabled: boolean) {
      if (this.isEnabled === enabled) return;
      this.isEnabled = enabled;
      calls.enabled.push(enabled);
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
