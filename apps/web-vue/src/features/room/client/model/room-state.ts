import { markRaw, reactive } from 'vue';
import {
  DEFAULT_SCREEN_FPS_ID,
  DEFAULT_SCREEN_PROFILE_ID,
  DEFAULT_SCREEN_STREAM_MODE,
  DEFAULT_SCREEN_QUALITY_ID,
  CAMERA_DEVICE_STORAGE_KEY,
  MICROPHONE_DEVICE_STORAGE_KEY,
  OUTPUT_DEVICE_STORAGE_KEY,
  OUTPUT_MUTED_STORAGE_KEY
} from '../core/config';
import { getRoomIdFromPath, getStoredPeerSession } from '../core/session';
import {
  getStoredGateThresholdDb,
  getStoredMicrophoneMode,
  getStoredMicrophoneVolume,
  getStoredNoiseMode,
  getStoredStreamVolume
} from '../core/settings';
import type { AppState } from '../core/types';
import { readStorage } from '@/shared/storage';

export function createInitialRoomState(): AppState {
  const roomId = getRoomIdFromPath();
  const peerSession = getStoredPeerSession(roomId);
  const screenQualityId = DEFAULT_SCREEN_QUALITY_ID;
  const screenFpsId = DEFAULT_SCREEN_FPS_ID;
  const screenProfileId = DEFAULT_SCREEN_PROFILE_ID;

  return {
    audioContext: null,
    audioUnlockPending: false,
    connecting: false,
    voiceRealtimeTeardown: null,
    gateThresholdDb: getStoredGateThresholdDb(),
    joined: false,
    localConnectionQuality: 'unknown',
    livekitRoom: null,
    localPingMs: null,
    localNetwork: { inboundLossPct: null, jitterMs: null, outboundLossPct: null, transport: null },
    localMicPublication: null,
    localCameraPublication: null,
    localCameraStream: null,
    cameraDeviceId: readStorage(CAMERA_DEVICE_STORAGE_KEY) || '',
    cameraFacing: 'user',
    cameraStarting: false,
    localScreenPublications: markRaw(new Map()),
    localScreenAudioCapture: null,
    localScreenStats: null,
    localScreenStatsPrevious: null,
    localScreenStatsTimer: 0,
    localScreenQualityId: screenQualityId,
    localScreenFpsId: screenFpsId,
    localRawStream: null,
    localScreenStream: null,
    localScreenProfileId: screenProfileId,
    localScreenMode: DEFAULT_SCREEN_STREAM_MODE,
    localStream: null,
    microphoneMissing: false,
    videoRelieved: false,
    localAppAudioSuppressed: false,
    microphoneDeviceId: readStorage(MICROPHONE_DEVICE_STORAGE_KEY) || '',
    microphoneMode: getStoredMicrophoneMode(),
    microphoneVolume: getStoredMicrophoneVolume(),
    micMutedBeforeOutputMute: false,
    micProcessor: null,
    muted: false,
    noiseMode: getStoredNoiseMode(),
    outputDeviceId: readStorage(OUTPUT_DEVICE_STORAGE_KEY) || '',
    outputMuted: readStorage(OUTPUT_MUTED_STORAGE_KEY) === 'true',
    pushToTalkActive: false,
    peers: reactive(new Map()),
    peerId: peerSession.peerId,
    roomId,
    moderationReason: '',
    roomAvatarUrl: '',
    roomName: '',
    roomIsStatic: false,
    roomRoute: window.location.pathname.startsWith('/r/'),
    savedName: '',
    screenFullscreen: false,
    screenMuted: false,
    screenRequesting: false,
    screenStarting: false,
    screenCollapsedPeerIds: reactive(new Set()),
    screenSubscribedPeerIds: reactive(new Set()),
    screenSourceRequest: null,
    screenStopping: false,
    screenVolume: getStoredStreamVolume(),
    stripCollapsed: false,
    self: null,
    serverConnection: 'idle',
    serverPeerIds: reactive(new Set()),
    serverPeerSyncReady: false,
    sessionToken: peerSession.sessionToken,
    sharedScreenPeerId: '',
    voiceConnection: 'idle',
    viewedScreenPeerId: ''
  };
}
