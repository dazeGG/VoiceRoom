import type { ConnectionQuality, LocalTrackPublication, Room } from 'livekit-client';
import type { HotkeyBinding } from '@/shared/ui/HotkeyRecorder/types';
import type { MicrophoneMode, NoiseMode } from './config';
import type { Participant } from '../model/participants';
import type { LobbyRoom } from '@voice-room/shared/contracts/rooms';
export type { Participant, PeerInfo } from '../model/participants';

export type ScreenStreamMode = 'games' | 'text';

export interface ScreenProfile {
  contentHint: string;
  detail: string;
  frameRate: number;
  fpsId: string;
  height: number;
  id: string;
  label: string;
  qualityId: string;
  videoBitrate: number;
  width: number;
}

export interface PeerSession {
  peerId: string;
  sessionToken: string;
}

interface MicStageBase {
  context: AudioContext;
  destination: MediaStreamAudioDestinationNode;
  node: AudioNode;
  source: MediaStreamAudioSourceNode;
}

/** One stage of the microphone chain: a gate always takes a threshold, the input gain a gain. */
export type MicProcessor =
  | (MicStageBase & { type: 'rnnoise' | 'silence-floor' })
  | (MicStageBase & { type: 'gate'; setThreshold: (threshold: number) => void })
  | (MicStageBase & { type: 'input-gain'; nodes: AudioNode[]; setGain: (gain: number) => void });

export interface MicrophoneCapture {
  mode?: NoiseMode;
  processor: MicProcessor[] | null;
  rawStream: MediaStream | null;
  stream: MediaStream | null;
}

export interface DesktopAudioCapture {
  audioContext: AudioContext;
  cleanup: (() => void) | null;
  destination: MediaStreamAudioDestinationNode;
  removeDataListener: () => void;
  removeEventListener: () => void;
  sessionId: string;
  source: AudioWorkletNode;
  track: MediaStreamTrack;
}

export interface DesktopCaptureSource {
  id: string;
  name: string;
  type?: string;
  thumbnail?: string;
  appIcon?: string;
}

export interface DesktopPickerSelection {
  profileId?: string;
  qualityId?: string;
  fpsId?: string;
  streamAudioEnabled?: boolean;
}

export interface ScreenSourceSelection extends DesktopPickerSelection {
  mode: ScreenStreamMode;
  source: DesktopCaptureSource;
}

export interface ScreenStatsSnapshot {
  availableOutgoingBitrate: number;
  bitrate: number;
  captureDropsBackpressure?: number | undefined;
  captureDropsBackpressureDelta?: number | undefined;
  captureFramesReceived?: number | undefined;
  captureFramesWritten?: number | undefined;
  capturePixelFormat?: 'NV12' | 'BGRX' | undefined;
  captureRelayRestarts?: number | undefined;
  codec: string;
  encoderImplementation: string;
  firCount: number;
  firDelta: number;
  fps: number;
  framesDropped: number;
  framesDroppedDelta: number;
  framesEncoded: number;
  framesSent: number;
  height: number;
  keyFramesEncoded: number;
  lossPct: number | null;
  nackCount: number;
  nackDelta: number;
  pliCount: number;
  pliDelta: number;
  qualityLimitationReason: string;
  qpSum: number;
  rttMs: number | null;
  width: number;
}

export interface ScreenStatsPrevious {
  bytesSent: number;
  encoderImplementation?: string;
  captureDropsBackpressure?: number;
  captureFramesReceived?: number;
  captureFramesWritten?: number;
  firCount: number;
  framesDropped: number;
  framesEncoded: number;
  nackCount: number;
  pliCount: number;
  timestamp: number;
}

export interface ParsedScreenStats extends Partial<ScreenStatsSnapshot> {
  previous: ScreenStatsPrevious | null;
}

export interface ScreenSourceRequest {
  resolve: (selection: ScreenSourceSelection) => void;
  reject: (error: Error) => void;
}

export interface RoomSessionState {
  joined: boolean;
  peerId: string;
  roomId: string;
  roomAvatarUrl: string;
  roomName: string;
  /** Permanent rooms survive being empty; temporary ones are deleted once idle. */
  roomIsStatic: boolean;
  moderationReason: 'banned' | 'kicked' | '';
  roomRoute: boolean;
  savedName: string;
  sessionToken: string;
}

/**
 * What the connection pill reports beyond ping: packet loss both ways, jitter
 * of what we hear, and whether media had to fall back to TCP or a relay.
 */
export interface LocalNetworkStats {
  inboundLossPct: number | null;
  jitterMs: number | null;
  outboundLossPct: number | null;
  transport: 'udp' | 'tcp' | 'relay' | null;
}

/** The room event channel as the connection pill reads it. */
export type ServerConnection = 'idle' | 'connecting' | 'reconnecting' | 'connected';

/** The LiveKit voice link as the connection pill reads it. */
export type VoiceConnection =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'signal-reconnecting'
  | 'lost'
  | 'error'
  | 'no-route'
  | 'playback-blocked';

/** LiveKit's rating of the local link, by its string values. */
export type LocalConnectionQuality = `${ConnectionQuality}`;

export interface RoomConnectionState {
  connecting: boolean;
  voiceRealtimeTeardown: (() => void) | null;
  localConnectionQuality: LocalConnectionQuality;
  localPingMs: number | null;
  localNetwork: LocalNetworkStats;
  livekitRoom: Room | null;
  serverConnection: ServerConnection;
  serverPeerIds: Set<string>;
  serverPeerSyncReady: boolean;
  voiceConnection: VoiceConnection;
}

export interface RoomParticipantState {
  peers: Map<string, Participant>;
  self: Participant | null;
}

export interface RoomAudioState {
  audioContext: AudioContext | null;
  audioUnlockPending: boolean;
  gateThresholdDb: number;
  localMicPublication: LocalTrackPublication | null;
  localRawStream: MediaStream | null;
  localStream: MediaStream | null;
  /** In the call without a microphone: none was found or access was refused. */
  microphoneMissing: boolean;
  /** The computer stayed overloaded: video goes out and comes in lighter for the rest of the call (video-relief.ts). */
  videoRelieved: boolean;
  localAppAudioSuppressed: boolean;
  microphoneDeviceId: string;
  microphoneMode: MicrophoneMode;
  microphoneVolume: number;
  micMutedBeforeOutputMute: boolean;
  micProcessor: MicProcessor[] | null;
  muted: boolean;
  noiseMode: NoiseMode;
  outputDeviceId: string;
  outputMuted: boolean;
  pushToTalkActive: boolean;
}

export interface RoomScreenState {
  localScreenPublications: Map<string, LocalTrackPublication>;
  localScreenAudioCapture: DesktopAudioCapture | null;
  localScreenStats: ScreenStatsSnapshot | null;
  localScreenStatsPrevious: ScreenStatsPrevious | null;
  localScreenStatsTimer: number;
  localScreenQualityId: string;
  localScreenFpsId: string;
  localScreenStream: MediaStream | null;
  localScreenProfileId: string;
  localScreenMode: ScreenStreamMode;
  screenFullscreen: boolean;
  screenMuted: boolean;
  screenRequesting: boolean;
  screenStarting: boolean;
  screenCollapsedPeerIds: Set<string>;
  screenSubscribedPeerIds: Set<string>;
  screenSourceRequest: ScreenSourceRequest | null;
  screenStopping: boolean;
  screenVolume: number;
  stripCollapsed: boolean;
  sharedScreenPeerId: string;
  viewedScreenPeerId: string;
}

export type CameraFacing = 'user' | 'environment';

export interface RoomCameraState {
  cameraDeviceId: string;
  /** Which way the phone camera looks; only the front one is shown mirrored. */
  cameraFacing: CameraFacing;
  /** Capture is being opened; the button waits instead of starting a second one. */
  cameraStarting: boolean;
  localCameraPublication: LocalTrackPublication | null;
  localCameraStream: MediaStream | null;
}

export interface AppState
  extends
    RoomSessionState,
    RoomConnectionState,
    RoomParticipantState,
    RoomAudioState,
    RoomScreenState,
    RoomCameraState {}

/** The lobby card the rename answer and the room.updated broadcast carry. */
export type RoomLifecycleSummary = LobbyRoom;

// Events from the desktop app's stream-audio helper. Desktop 1.4.4+ restarts a
// crashed helper under the same session ('restarting') and sends 'exit' only when
// it gives up.
interface DesktopAudioFormatEvent {
  event: 'format' | 'error' | 'warning' | 'started' | 'stopped' | 'log' | 'restarting' | 'exit';
  message?: string;
  channels?: number;
  sampleRate?: number;
  attempt?: number;
  delayMs?: number;
  code?: number | null;
  signal?: string | null;
}

declare global {
  interface Window {
    voiceRoomDesktopCapture?: {
      applyProfile?: (options: { fpsId?: string; qualityId?: string }) => Promise<{
        fpsId?: string;
        maxHeight?: number;
        maxWidth?: number;
        ok: boolean;
        qualityId?: string;
        reason?: string;
      }>;
      openPicker?: (options: {
        fpsId?: string;
        qualityId?: string;
        streamAudioEnabled?: boolean;
      }) => Promise<DesktopPickerSelection | null>;
      getSources?: () => Promise<DesktopCaptureSource[]>;
      selectSource?: (
        sourceId: string,
        options: { allowEchoFallback?: boolean; enabled?: boolean; mode?: string },
        captureOptions?: { fpsId?: string; qualityId?: string }
      ) => Promise<void>;
    };
    __voiceRoomNativeCaptureStats?: () => {
      framesDroppedBackpressure?: number;
      framesDroppedCreate?: number;
      framesReceived?: number;
      framesWritten?: number;
      pixelFormat?: 'NV12' | 'BGRX';
      relay?: {
        framesDroppedBackpressure?: number;
        framesInFlight?: number;
        framesParsed?: number;
        framesPosted?: number;
        restarts?: number;
      } | null;
      sessionId?: string;
    };
    voiceRoomDesktopAudio?: {
      startSafeSystem: (options: { mode: string }) => Promise<{ sessionId: string }>;
      stop: (sessionId: string) => Promise<void>;
      onData: (callback: (payload: { sessionId: string; chunk: Uint8Array | ArrayBuffer }) => void) => () => void;
      onEvent: (callback: (payload: { sessionId: string; event: DesktopAudioFormatEvent }) => void) => () => void;
    };
    voiceRoomDesktopHotkeys?: {
      configure: (payload: {
        active: boolean;
        configurationId: number;
        bindings: Partial<Record<'mic-mute' | 'output-mute' | 'push-to-talk', HotkeyBinding | null>>;
      }) => Promise<{
        active: boolean;
        backend: 'native' | 'electron-fallback' | 'none';
        configurationId?: number;
        failed: Array<{ action: 'mic-mute' | 'output-mute' | 'push-to-talk'; reason: string }>;
        registered: Array<'mic-mute' | 'output-mute' | 'push-to-talk'>;
        unsupported: Array<'mic-mute' | 'output-mute' | 'push-to-talk'>;
      }>;
      onAction: (
        callback: (payload: {
          action: 'mic-mute' | 'output-mute' | 'push-to-talk';
          configurationId?: number;
          phase: 'pressed' | 'released';
        }) => void
      ) => () => void;
      onStatus: (
        callback: (result: {
          active: boolean;
          backend: 'native' | 'electron-fallback' | 'none';
          configurationId?: number;
          failed: Array<{ action: 'mic-mute' | 'output-mute' | 'push-to-talk'; reason: string }>;
          registered: Array<'mic-mute' | 'output-mute' | 'push-to-talk'>;
          unsupported: Array<'mic-mute' | 'output-mute' | 'push-to-talk'>;
        }) => void
      ) => () => void;
      setSuspended: (suspended: boolean) => Promise<boolean>;
    };
    voiceRoomRuntime?: {
      isDesktop?: boolean;
      platform?: string;
    };
    voiceRoomWindow?: {
      setFullscreen: (fullscreen: boolean) => Promise<boolean>;
    };
  }
}
