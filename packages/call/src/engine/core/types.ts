import type { ConnectionQuality, LocalTrackPublication, Room } from 'livekit-client';
import type { MicrophoneMode, NoiseMode } from './config';
import type { Participant } from '../model/participants';
import type { LobbyRoom } from '@voiceroom/shared/contracts/rooms';
import type { VoiceVerdict } from '@voiceroom/shared/voice-quality';
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
  | (MicStageBase & {
      type: 'input-gain';
      nodes: AudioNode[];
      setGain: (gain: number) => void;
      setHardZero: () => void;
    });

export interface MicrophoneCapture {
  /** Candidate capture cannot carry signal until its publication is confirmed. */
  barrier?: boolean;
  removeProcessorErrorListener?: () => void;
  processorFailed?: boolean;
  removeRawEndedListener?: () => void;
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
  missingRoomLabel: string;
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
  /** The server's verdict on our voice, from everyone's stats polls (room.voice.quality); null until it says. */
  voiceQuality: VoiceVerdict | null;
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
