import { SvelteMap } from 'svelte/reactivity';
import {
  DEFAULT_SCREEN_FPS_ID,
  DEFAULT_SCREEN_PROFILE_ID,
  DEFAULT_SCREEN_QUALITY_ID,
  MICROPHONE_DEVICE_STORAGE_KEY,
  OUTPUT_DEVICE_STORAGE_KEY,
  OUTPUT_MUTED_STORAGE_KEY
} from '../core/config';
import { getRoomIdFromPath, getStoredPeerSession } from '../core/session';
import { getStoredGateThresholdDb, getStoredNoiseMode, getStoredStreamVolume } from '../core/settings';
import type { AppState } from '../core/types';

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
    localMicPublication: null,
    localScreenPublications: new Map(),
    localScreenAdaptGoodSamples: 0,
    localScreenAdaptLastAt: 0,
    localScreenAdaptPoorSamples: 0,
    localScreenAudioCapture: null,
    localScreenStats: null,
    localScreenStatsPrevious: null,
    localScreenStatsTimer: 0,
    localScreenQualityId: screenQualityId,
    localScreenFpsId: screenFpsId,
    localScreenTargetProfileId: screenProfileId,
    localRawStream: null,
    localScreenStream: null,
    localScreenProfileId: screenProfileId,
    localStream: null,
    localAppAudioSuppressed: false,
    microphoneDeviceId: localStorage.getItem(MICROPHONE_DEVICE_STORAGE_KEY) || '',
    micMutedBeforeOutputMute: false,
    micProcessor: null,
    muted: false,
    noiseMode: getStoredNoiseMode(),
    outputDeviceId: localStorage.getItem(OUTPUT_DEVICE_STORAGE_KEY) || '',
    outputMuted: localStorage.getItem(OUTPUT_MUTED_STORAGE_KEY) === 'true',
    peers: new SvelteMap(),
    peerId: peerSession.peerId,
    roomId,
    roomName: '',
    roomEmoji: '',
    roomColorKey: '',
    roomIconKey: '',
    roomPresetKey: '',
    roomRoute: window.location.pathname.startsWith('/r/'),
    screen: '',
    savedName: '',
    screenFullscreen: false,
    screenMuted: false,
    screenRequesting: false,
    screenStarting: false,
    screenCollapsedPeerIds: new Set(),
    screenSubscribedPeerIds: new Set(),
    screenSourceRequest: null,
    screenStopping: false,
    screenVolume: getStoredStreamVolume(),
    stripCollapsed: false,
    self: null,
    serverConnection: 'idle',
    serverPeerIds: new Set(),
    serverPeerSyncReady: false,
    sessionToken: peerSession.sessionToken,
    sharedScreenPeerId: '',
    voiceConnection: 'idle',
    viewedScreenPeerId: ''
  };
}
