import {
  DEFAULT_SCREEN_FPS_ID,
  DEFAULT_SCREEN_PROFILE_ID,
  DEFAULT_SCREEN_QUALITY_ID,
  MICROPHONE_DEVICE_STORAGE_KEY,
  OUTPUT_DEVICE_STORAGE_KEY,
  OUTPUT_MUTED_STORAGE_KEY
} from './config';
import { getRoomIdFromPath, getStoredPeerSession } from './session';
import { getStoredGateThresholdDb, getStoredNoiseMode } from './settings';
import type { AppState } from './types';

const initialRoomId = getRoomIdFromPath();
const initialPeerSession = getStoredPeerSession(initialRoomId);
const initialScreenQualityId = DEFAULT_SCREEN_QUALITY_ID;
const initialScreenFpsId = DEFAULT_SCREEN_FPS_ID;
const initialScreenProfileId = DEFAULT_SCREEN_PROFILE_ID;

export const state: AppState = {
  audioContext: null,
  audioUnlockPending: false,
  autoJoinStarted: false,
  connecting: false,
  eventSource: null,
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
  localScreenQualityId: initialScreenQualityId,
  localScreenFpsId: initialScreenFpsId,
  localScreenTargetProfileId: initialScreenProfileId,
  localRawStream: null,
  localScreenStream: null,
  localScreenProfileId: initialScreenProfileId,
  localStream: null,
  localAppAudioSuppressed: false,
  microphoneDeviceId: localStorage.getItem(MICROPHONE_DEVICE_STORAGE_KEY) || '',
  micMutedBeforeOutputMute: false,
  micProcessor: null,
  muted: false,
  noiseMode: getStoredNoiseMode(),
  outputDeviceId: localStorage.getItem(OUTPUT_DEVICE_STORAGE_KEY) || '',
  outputMuted: localStorage.getItem(OUTPUT_MUTED_STORAGE_KEY) === 'true',
  peers: new Map(),
  peerId: initialPeerSession.peerId,
  roomId: initialRoomId,
  roomRoute: window.location.pathname.startsWith('/r/'),
  savedName: '',
  screenFullscreen: false,
  screenMuted: false,
  screenRequesting: false,
  screenCollapsedPeerIds: new Set(),
  screenSubscribedPeerIds: new Set(),
  screenSourceRequest: null,
  screenStopping: false,
  screenVolume: 1,
  stripCollapsed: false,
  self: null,
  serverConnection: 'idle',
  serverPeerIds: new Set(),
  serverPeerSyncReady: false,
  sessionToken: initialPeerSession.sessionToken,
  sharedScreenPeerId: '',
  voiceConnection: 'idle',
  viewedScreenPeerId: ''
};
