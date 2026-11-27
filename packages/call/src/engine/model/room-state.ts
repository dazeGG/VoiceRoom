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
import {
  getStoredGateThresholdDb,
  getStoredMicrophoneMode,
  getStoredMicrophoneVolume,
  getStoredNoiseMode,
  getStoredStreamVolume
} from '../core/settings';
import type { AppState } from '../core/types';
import { readStorage } from '../core/storage';

export function readRoomPreferences() {
  return {
    gateThresholdDb: getStoredGateThresholdDb(),
    cameraDeviceId: readStorage(CAMERA_DEVICE_STORAGE_KEY) || '',
    microphoneDeviceId: readStorage(MICROPHONE_DEVICE_STORAGE_KEY) || '',
    microphoneMode: getStoredMicrophoneMode(),
    microphoneVolume: getStoredMicrophoneVolume(),
    noiseMode: getStoredNoiseMode(),
    outputDeviceId: readStorage(OUTPUT_DEVICE_STORAGE_KEY) || '',
    outputMuted: readStorage(OUTPUT_MUTED_STORAGE_KEY) === 'true',
    screenVolume: getStoredStreamVolume()
  };
}

export function createInitialRoomState(): AppState {
  const screenQualityId = DEFAULT_SCREEN_QUALITY_ID;
  const screenFpsId = DEFAULT_SCREEN_FPS_ID;
  const screenProfileId = DEFAULT_SCREEN_PROFILE_ID;

  return {
    ...readRoomPreferences(),
    audioContext: null,
    audioUnlockPending: false,
    connecting: false,
    voiceRealtimeTeardown: null,
    joined: false,
    localConnectionQuality: 'unknown',
    livekitRoom: null,
    localPingMs: null,
    localNetwork: { inboundLossPct: null, jitterMs: null, outboundLossPct: null, transport: null },
    voiceQuality: null,
    localMicPublication: null,
    localCameraPublication: null,
    localCameraStream: null,
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
    micMutedBeforeOutputMute: false,
    micProcessor: null,
    muted: false,
    pushToTalkActive: false,
    peers: reactive(new Map()),
    peerId: '',
    roomId: '',
    callId: undefined,
    moderationReason: '',
    roomAvatarUrl: '',
    roomName: '',
    roomIsStatic: false,
    roomRoute: false,
    missingRoomLabel: '',
    savedName: '',
    screenFullscreen: false,
    screenMuted: false,
    screenRequesting: false,
    screenStarting: false,
    screenCollapsedPeerIds: reactive(new Set()),
    screenSubscribedPeerIds: reactive(new Set()),
    screenSourceRequest: null,
    screenStopping: false,
    stripCollapsed: false,
    self: null,
    serverConnection: 'idle',
    serverPeerIds: reactive(new Set()),
    serverPeerSyncReady: false,
    sessionToken: '',
    sharedScreenPeerId: '',
    voiceConnection: 'idle',
    voiceRecoveryFailed: false,
    viewedScreenPeerId: ''
  };
}
