// What code outside the room feature may use of the room client: the sounds,
// hotkeys and sound settings the lobby shares with a call, and the few actions
// the lobby's settings take on a running call. Everything else stays inside.

export {
  playDirectMessageCue,
  playFriendAcceptedCue,
  playFriendRequestCue,
  playMicCue,
  playPeerCue,
  playRingCue,
  playRoomChatMessageCue,
  playStreamCue
} from './media/cues';
export { getDefaultHotkeyBinding, readHotkeyBinding, writeHotkeyBinding, type HotkeyAction } from './core/hotkeys';
export { desktopGlobalHotkeysAvailable, setDesktopGlobalHotkeysSuspended } from './services/desktop-hotkey-service';
export {
  DEFAULT_GATE_THRESHOLD_DB,
  DEFAULT_MASTER_VOLUME,
  DEFAULT_MICROPHONE_MODE,
  DEFAULT_MICROPHONE_VOLUME,
  DEFAULT_NOISE_MODE,
  DEFAULT_NOTIFICATION_VOLUME,
  GATE_ON_DEFAULT_DB,
  GATE_THRESHOLD_DB_STORAGE_KEY,
  GATE_THRESHOLD_MAX_DB,
  GATE_THRESHOLD_MIN_DB,
  MICROPHONE_DEVICE_STORAGE_KEY,
  NOISE_MODES,
  NOISE_MODE_STORAGE_KEY,
  OUTPUT_DEVICE_STORAGE_KEY,
  type MicrophoneMode,
  type NoiseMode
} from './core/config';
export {
  amplitudeToDb,
  clampGateThresholdDb,
  getDbMeterPosition,
  getNoiseMode,
  getNotificationVolumeMultiplier,
  getStoredGateThresholdDb,
  getStoredMasterVolume,
  getStoredMicrophoneMode,
  getStoredMicrophoneVolume,
  getStoredNoiseMode,
  getStoredNotificationVolume,
  isNoiseMode,
  persistMasterVolume,
  persistNotificationVolume
} from './core/settings';
export { clientRoomName } from './core/room-runtime.store';
export { setOutputDevice, syncAudioBusSettings } from './services/audio-bus';
export { setMicrophoneVolume } from './services/microphone-service';
export { setMicrophoneMode } from './ui/controls';
export { syncLocalProfile } from './room/participants';
