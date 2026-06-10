import type { LocalTrackPublication, Participant as LiveKitParticipant, Room } from 'livekit-client';
import type { NoiseMode } from './config';

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

export interface PeerInfo {
  id: string;
  name?: string;
  deafened?: boolean;
  muted?: boolean;
  screen?: boolean;
  screenAudio?: boolean;
  screenProfileId?: string;
  screenStreamId?: string;
  viewedScreenPeerId?: string;
  joinedAt?: number;
  isLocal?: boolean;
}

export interface Participant {
  analyser: AnalyserNode | null;
  audioElements: Map<string, HTMLAudioElement>;
  deafened: boolean;
  id: string;
  incomingVoiceActive: boolean;
  isLocal: boolean;
  joinedAt: number;
  livekitParticipant: LiveKitParticipant | null;
  connectionQuality: string;
  meterData: Uint8Array<ArrayBuffer> | null;
  muted: boolean;
  name: string;
  node: HTMLElement;
  micReceiver: RTCRtpReceiver | null;
  screen: boolean;
  screenAction: HTMLButtonElement;
  screenAudio: boolean;
  screenProfileId: string;
  screenStream: MediaStream | null;
  screenStreamId: string;
  status: HTMLParagraphElement;
  stream: MediaStream | null;
  viewedScreenPeerId: string;
  voiceIssue: string;
}

export interface MicProcessor {
  context: AudioContext;
  destination: MediaStreamAudioDestinationNode;
  node: AudioNode;
  source: MediaStreamAudioSourceNode;
  setThreshold?: (threshold: number) => void;
  type?: 'gate';
}

export interface MicrophoneCapture {
  kind?: string;
  mode?: NoiseMode;
  processor: MicProcessor | MicProcessor[] | null;
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

export interface ScreenStatsSnapshot {
  availableOutgoingBitrate: number;
  bitrate: number;
  codec: string;
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
  resolve: (source: DesktopCaptureSource) => void;
  reject: (error: Error) => void;
}

export interface AppState {
  audioContext: AudioContext | null;
  audioUnlockPending: boolean;
  autoJoinStarted: boolean;
  connecting: boolean;
  eventSource: EventSource | null;
  gateThresholdDb: number;
  joined: boolean;
  localConnectionQuality: string;
  livekitRoom: Room | null;
  localPingMs: number | null;
  localMicPublication: LocalTrackPublication | null;
  localScreenPublications: Map<string, LocalTrackPublication>;
  localScreenAdaptGoodSamples: number;
  localScreenAdaptLastAt: number;
  localScreenAdaptPoorSamples: number;
  localScreenAudioCapture: DesktopAudioCapture | null;
  localScreenStats: ScreenStatsSnapshot | null;
  localScreenStatsPrevious: ScreenStatsPrevious | null;
  localScreenStatsTimer: number;
  localScreenQualityId: string;
  localScreenFpsId: string;
  localScreenTargetProfileId: string;
  localRawStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  localScreenProfileId: string;
  localStream: MediaStream | null;
  localAppAudioSuppressed: boolean;
  microphoneDeviceId: string;
  micMutedBeforeOutputMute: boolean;
  micProcessor: MicProcessor | MicProcessor[] | null;
  muted: boolean;
  noiseMode: NoiseMode;
  outputDeviceId: string;
  outputMuted: boolean;
  peers: Map<string, Participant>;
  peerId: string;
  roomId: string;
  roomRoute: boolean;
  savedName: string;
  screenFullscreen: boolean;
  screenMuted: boolean;
  screenRequesting: boolean;
  screenSubscribedPeerIds: Set<string>;
  screenSourceRequest: ScreenSourceRequest | null;
  screenStopping: boolean;
  screenVolume: number;
  stripCollapsed: boolean;
  self: Participant | null;
  serverConnection: string;
  serverPeerIds: Set<string>;
  serverPeerSyncReady: boolean;
  sessionToken: string;
  sharedScreenPeerId: string;
  voiceConnection: string;
  viewedScreenPeerId: string;
}

export type ServerMessage =
  | { type: 'hello'; peer: PeerInfo; peers: PeerInfo[]; roomId: string }
  | { type: 'ping'; at: number }
  | { type: 'room-not-found'; roomId: string }
  | { type: 'peer-joined'; peer: PeerInfo }
  | { type: 'peer-left'; peerId: string; reason: string }
  | { type: 'peer-updated'; peer: PeerInfo }
  | { type: 'room-full'; maxRoomPeers: number };

interface DesktopAudioFormatEvent {
  event: 'format' | 'error';
  message?: string;
  channels?: number;
  sampleRate?: number;
}

declare global {
  interface Window {
    voiceRoomDesktopCapture?: {
      openPicker?: (options: {
        fpsId?: string;
        qualityId?: string;
        streamAudioEnabled?: boolean;
      }) => Promise<DesktopPickerSelection | null>;
      getSources?: () => Promise<DesktopCaptureSource[]>;
      selectSource?: (
        sourceId: string,
        options: { allowEchoFallback?: boolean; enabled?: boolean; mode?: string }
      ) => Promise<void>;
    };
    voiceRoomDesktopAudio?: {
      startSafeSystem: (options: { mode: string }) => Promise<{ sessionId: string }>;
      stop: (sessionId: string) => Promise<void>;
      onData: (
        callback: (payload: { sessionId: string; chunk: Uint8Array | ArrayBuffer }) => void
      ) => () => void;
      onEvent: (
        callback: (payload: { sessionId: string; event: DesktopAudioFormatEvent }) => void
      ) => () => void;
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
