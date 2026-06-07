'use strict';

const $ = (selector) => document.querySelector(selector);
const LiveKitClient = window.LivekitClient || {};
const {
  AudioPresets,
  Room: LiveKitRoom,
  RoomEvent,
  Track
} = LiveKitClient;
const DEFAULT_NOISE_MODE = 'browser';
const DEFAULT_GATE_THRESHOLD_DB = -100;
const GATE_THRESHOLD_DB_STORAGE_KEY = 'voice-room:gate-threshold-db';
const LEGACY_GATE_THRESHOLD_STORAGE_KEY = 'voice-room:gate-threshold';
const GATE_THRESHOLD_MAX_DB = 0;
const GATE_THRESHOLD_MIN_DB = -100;
const LEGACY_GATE_MAX_AMPLITUDE = 0.18;
const LEGACY_GATE_MIN_AMPLITUDE = 0.006;
const AUDIO_GATE_WORKLET_URL = '/audio-gate.worklet.js';
const GATE_ATTACK_MS = 8;
const GATE_CLOSE_RATIO = 0.65;
const GATE_DETECTOR_ATTACK_MS = 4;
const GATE_DETECTOR_RELEASE_MS = 55;
const GATE_FLOOR_GAIN = 0.02;
const GATE_HOLD_MS = 140;
const GATE_PROCESSOR_BUFFER_SIZE = 2048;
const GATE_RELEASE_MS = 160;
const NOTIFICATION_VOLUME_BOOST = 3;
const MICROPHONE_DEVICE_STORAGE_KEY = 'voice-room:microphone-device-id';
const NOISE_MODE_STORAGE_KEY = 'voice-room:noise-mode';
const OUTPUT_DEVICE_STORAGE_KEY = 'voice-room:output-device-id';
const OUTPUT_MUTED_STORAGE_KEY = 'voice-room:output-muted';
const PEER_LATENCY_INTERVAL_MS = 3000;
const PEER_LATENCY_GOOD_MS = 150;
const PEER_LATENCY_FAIR_MS = 300;
const PEER_RECONNECT_COOLDOWN_MS = 5000;
const PEER_RECONNECT_DELAY_MS = 1200;
const LOCAL_GATE_DISABLED_RMS_FLOOR = 0.5;
const SPEAKING_STATS_INTERVAL_MS = 200;
const REMOTE_SPEAKING_AUDIO_LEVEL_FLOOR = 0.005;
const REMOTE_SPEAKING_SIGNAL_POWER_FLOOR = REMOTE_SPEAKING_AUDIO_LEVEL_FLOOR ** 2;
const SPEAKING_SIGNAL_HOLD_MS = 450;
const NOISE_MODES = {
  browser: {
    label: 'Браузерный',
    nativeNoiseSuppression: true
  },
  off: {
    label: 'Выкл',
    nativeNoiseSuppression: false
  },
  rnnoise: {
    label: 'RNNoise',
    nativeNoiseSuppression: false
  }
};
const RNNOISE_ASSET_BASE = '/rnnoise/';
const DEFAULT_SCREEN_PROFILE_ID = 'balanced';
const MICROPHONE_AUDIO_BITRATE = 64_000;
const SCREEN_AUDIO_BITRATE = 192_000;
const ROOM_PROOF_BATCH_SIZE = 64;
const SCREEN_STREAM_PROFILES = {
  balanced: {
    contentHint: 'detail',
    detail: '720p · 24 fps',
    frameRate: 24,
    height: 720,
    id: 'balanced',
    intent: 'Показ экрана',
    label: 'Приемлемый',
    videoBitrate: 2_200_000,
    width: 1280
  },
  high: {
    contentHint: 'motion',
    detail: '1080p · 30 fps',
    frameRate: 30,
    height: 1080,
    id: 'high',
    intent: 'Совместный просмотр',
    label: 'Высокий',
    videoBitrate: 5_500_000,
    width: 1920
  },
  low: {
    contentHint: 'detail',
    detail: '540p · 12 fps',
    frameRate: 12,
    height: 540,
    id: 'low',
    intent: 'Слабая сеть',
    label: 'Минимальный',
    videoBitrate: 800_000,
    width: 960
  }
};
const SCREEN_PROFILE_ORDER = ['balanced', 'high', 'low'];

const elements = {
  copyCodeButton: $('#copyCodeButton'),
  copyLinkButton: $('#copyLinkButton'),
  createRoomButton: $('#createRoomButton'),
  deviceMenuButton: $('#deviceMenuButton'),
  devicePopover: $('#devicePopover'),
  deviceSelect: $('#deviceSelect'),
  emptyRoom: $('#emptyRoom'),
  gateThresholdSlider: $('#gateThresholdSlider'),
  gateThresholdValue: $('#gateThresholdValue'),
  joinByCodeButton: $('#joinByCodeButton'),
  leaveButton: $('#leaveButton'),
  localNetwork: $('#localNetwork'),
  localNetworkValue: $('#localNetworkValue'),
  micGateMarker: $('#micGateMarker'),
  micLevelFill: $('#micLevelFill'),
  micLevelTrack: $('#micLevelTrack'),
  muteButton: $('#muteButton'),
  muteText: $('#muteText'),
  noiseModeSelect: $('#noiseModeSelect'),
  notFoundScreen: $('#notFoundScreen'),
  outputButton: $('#outputButton'),
  outputDeviceSelect: $('#outputDeviceSelect'),
  outputMenuButton: $('#outputMenuButton'),
  outputPopover: $('#outputPopover'),
  outputText: $('#outputText'),
  participants: $('#participants'),
  roomCodeInput: $('#roomCodeInput'),
  roomScreen: $('#roomScreen'),
  roomTitle: $('#roomTitle'),
  missingRoomCode: $('#missingRoomCode'),
  screenButton: $('#screenButton'),
  screenExitButton: $('#screenExitButton'),
  screenFullscreenButton: $('#screenFullscreenButton'),
  screenPlaceholder: $('#screenPlaceholder'),
  screenProfileOptions: $('#screenProfileOptions'),
  screenProfilePopover: $('#screenProfilePopover'),
  screenSourceCloseButton: $('#screenSourceCloseButton'),
  screenSourceDialog: $('#screenSourceDialog'),
  screenSourceOptions: $('#screenSourceOptions'),
  screenStage: $('#screenStage'),
  screenText: $('#screenText'),
  screenVideo: $('#screenVideo'),
  screenViewControls: $('#screenViewControls'),
  soundButton: $('#soundButton'),
  startForm: $('#startForm'),
  startNameInput: $('#startNameInput'),
  startNameStatus: $('#startNameStatus'),
  startScreen: $('#startScreen'),
  statusPill: $('#statusPill'),
  statusText: $('#statusText'),
  streamVolumeButton: $('#streamVolumeButton'),
  streamVolumeSlider: $('#streamVolumeSlider'),
  template: $('#participantTemplate'),
  toast: $('#toast')
};

const state = {
  audioContext: null,
  autoJoinStarted: false,
  connecting: false,
  eventSource: null,
  gateThresholdDb: getStoredGateThresholdDb(),
  iceConfig: { iceServers: [] },
  iceRefreshTimer: 0,
  joined: false,
  localConnectionQuality: 'unknown',
  livekitRoom: null,
  localPingMs: null,
  localMicPublication: null,
  localScreenPublications: new Map(),
  localRawStream: null,
  localScreenStream: null,
  localScreenProfileId: DEFAULT_SCREEN_PROFILE_ID,
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
  peerId: createPeerId(),
  roomId: getRoomIdFromPath(),
  roomRoute: window.location.pathname.startsWith('/r/'),
  savedName: '',
  screenFullscreen: false,
  screenMuted: false,
  screenRequesting: false,
  screenSourceRequest: null,
  screenStopping: false,
  screenVolume: 1,
  self: null,
  sessionToken: createSessionToken(),
  sharedScreenPeerId: '',
  viewedScreenPeerId: ''
};

let toastTimer = null;
let meterFrame = 0;
let gateSwitchTimer = 0;
let peerLatencyTimer = 0;
let speakingStatsTimer = 0;
let rnnoiseModulePromise = null;
const watchedRemoteScreenTracks = new WeakSet();

init();

function init() {
  const savedName = cleanDisplayName(localStorage.getItem('voice-room:name'));
  state.savedName = savedName;
  elements.startNameInput.value = savedName;
  elements.noiseModeSelect.value = state.noiseMode;
  elements.gateThresholdSlider.value = String(state.gateThresholdDb);
  refreshGateThresholdValue();
  refreshMicrophoneLevelMeter(GATE_THRESHOLD_MIN_DB);
  elements.startForm.addEventListener('submit', saveStartName);
  elements.createRoomButton.addEventListener('click', createRoomFromStart);
  elements.joinByCodeButton.addEventListener('click', joinRoomByCode);
  elements.roomCodeInput.addEventListener('keydown', handleRoomCodeKeydown);
  elements.startNameInput.addEventListener('input', updateNameStatuses);
  renderScreenProfileOptions();
  elements.copyCodeButton.addEventListener('click', copyRoomCode);
  elements.copyLinkButton.addEventListener('click', copyRoomLink);
  elements.muteButton.addEventListener('click', handleMicButtonClick);
  elements.outputButton.addEventListener('click', toggleOutputMute);
  elements.screenButton.addEventListener('click', handleScreenButtonClick);
  elements.screenExitButton.addEventListener('click', () => leaveScreenView().catch((error) => console.error(error)));
  elements.screenFullscreenButton.addEventListener('click', toggleScreenFullscreen);
  elements.screenSourceCloseButton.addEventListener('click', cancelScreenSourcePicker);
  elements.screenSourceDialog.addEventListener('click', closeScreenSourceOnBackdrop);
  elements.streamVolumeButton.addEventListener('click', toggleScreenMute);
  elements.streamVolumeSlider.addEventListener('input', updateScreenVolumeFromSlider);
  syncScreenVideoAudio();
  elements.deviceMenuButton.addEventListener('click', toggleDevicePopover);
  elements.outputMenuButton.addEventListener('click', toggleOutputPopover);
  elements.leaveButton.addEventListener('click', handleLeaveButtonClick);
  elements.soundButton.addEventListener('click', unlockAudio);
  elements.deviceSelect.addEventListener('change', switchMicrophone);
  elements.gateThresholdSlider.addEventListener('input', updateGateThresholdFromSlider);
  elements.noiseModeSelect.addEventListener('change', switchNoiseMode);
  elements.outputDeviceSelect.addEventListener('change', switchOutputDevice);
  document.addEventListener('click', closeDevicePopoverOnOutside);
  document.addEventListener('click', closeOutputPopoverOnOutside);
  document.addEventListener('click', closeScreenProfileOnOutside);
  document.addEventListener('keydown', closeDevicePopoverOnEscape);
  document.addEventListener('keydown', closeOutputPopoverOnEscape);
  document.addEventListener('keydown', closeScreenProfileOnEscape);
  document.addEventListener('keydown', closeScreenSourceOnEscape);
  document.addEventListener('fullscreenchange', updateScreenFullscreenState);
  navigator.mediaDevices?.addEventListener?.('devicechange', () => refreshDevices().catch(() => {}));
  window.addEventListener('beforeunload', leaveRoom);
  refreshOutputControls();
  refreshLocalNetworkIndicator();

  if (state.roomRoute && !state.roomId) {
    showRoomNotFound();
  } else if (state.roomId) {
    showRoomRoute().catch((error) => {
      console.error(error);
      showRoomNotFound();
      showToast('Не удалось проверить комнату');
    });
  } else {
    showStartScreen();
  }
}

function renderScreenProfileOptions() {
  elements.screenProfileOptions.textContent = '';
  for (const profileId of SCREEN_PROFILE_ORDER) {
    const profile = getScreenProfile(profileId);
    const button = document.createElement('button');
    button.className = 'screen-profile-option';
    button.type = 'button';
    button.dataset.profile = profile.id;
    button.setAttribute('aria-pressed', String(profile.id === state.localScreenProfileId));
    button.innerHTML = `
      <span class="screen-profile-copy">
        <strong>${profile.label}</strong>
        <span>${profile.intent}</span>
      </span>
      <span class="screen-profile-meta">${profile.detail}</span>
    `;
    button.addEventListener('click', () => {
      closeScreenProfilePopover();
      startScreenShare(profile.id).catch((error) => console.error(error));
    });
    elements.screenProfileOptions.append(button);
  }
}

function getScreenProfile(profileId) {
  return SCREEN_STREAM_PROFILES[profileId] || SCREEN_STREAM_PROFILES[DEFAULT_SCREEN_PROFILE_ID];
}

function getNoiseMode(mode) {
  return Object.hasOwn(NOISE_MODES, mode) ? mode : DEFAULT_NOISE_MODE;
}

function getStoredNoiseMode() {
  return getNoiseMode(localStorage.getItem(NOISE_MODE_STORAGE_KEY));
}

function getStoredGateThresholdDb() {
  const storedValue = Number.parseInt(localStorage.getItem(GATE_THRESHOLD_DB_STORAGE_KEY) || '', 10);
  if (Number.isFinite(storedValue)) return clampGateThresholdDb(storedValue);

  const legacyValue = Number.parseInt(localStorage.getItem(LEGACY_GATE_THRESHOLD_STORAGE_KEY) || '', 10);
  if (!Number.isFinite(legacyValue)) return DEFAULT_GATE_THRESHOLD_DB;

  const migratedValue = legacyGatePercentToDb(legacyValue);
  localStorage.setItem(GATE_THRESHOLD_DB_STORAGE_KEY, String(migratedValue));
  return migratedValue;
}

function setNoiseMode(mode) {
  state.noiseMode = getNoiseMode(mode);
  elements.noiseModeSelect.value = state.noiseMode;
  localStorage.setItem(NOISE_MODE_STORAGE_KEY, state.noiseMode);
}

function getNoiseModeLabel(mode) {
  return NOISE_MODES[getNoiseMode(mode)].label;
}

function setGateThresholdDb(value) {
  const threshold = Number.parseInt(value, 10);
  state.gateThresholdDb = Number.isFinite(threshold) ? clampGateThresholdDb(threshold) : DEFAULT_GATE_THRESHOLD_DB;
  elements.gateThresholdSlider.value = String(state.gateThresholdDb);
  localStorage.setItem(GATE_THRESHOLD_DB_STORAGE_KEY, String(state.gateThresholdDb));
  refreshGateThresholdValue();
}

function refreshGateThresholdValue() {
  elements.gateThresholdValue.textContent = isGateDisabled() ? 'Выкл' : `${state.gateThresholdDb} dB`;
  refreshGateMarker();
}

function getGateThresholdAmplitude() {
  if (isGateDisabled()) return 0;

  return dbToAmplitude(state.gateThresholdDb);
}

function clampGateThresholdDb(value) {
  return Math.min(GATE_THRESHOLD_MAX_DB, Math.max(GATE_THRESHOLD_MIN_DB, value));
}

function isGateDisabled() {
  return state.gateThresholdDb <= GATE_THRESHOLD_MIN_DB;
}

function dbToAmplitude(db) {
  return 10 ** (db / 20);
}

function amplitudeToDb(amplitude) {
  if (!Number.isFinite(amplitude) || amplitude <= 0) return GATE_THRESHOLD_MIN_DB;
  return Math.max(GATE_THRESHOLD_MIN_DB, Math.min(GATE_THRESHOLD_MAX_DB, 20 * Math.log10(amplitude)));
}

function legacyGatePercentToDb(value) {
  if (value <= 0) return DEFAULT_GATE_THRESHOLD_DB;

  const amount = Math.min(100, Math.max(0, value)) / 100;
  const amplitude = LEGACY_GATE_MIN_AMPLITUDE + amount * amount * (LEGACY_GATE_MAX_AMPLITUDE - LEGACY_GATE_MIN_AMPLITUDE);
  return Math.round(amplitudeToDb(amplitude));
}

function getDbMeterPosition(db) {
  const clampedDb = clampGateThresholdDb(db);
  return (clampedDb - GATE_THRESHOLD_MIN_DB) / (GATE_THRESHOLD_MAX_DB - GATE_THRESHOLD_MIN_DB);
}

function refreshGateMarker() {
  if (!elements.micGateMarker) return;

  const position = getDbMeterPosition(state.gateThresholdDb);
  elements.micGateMarker.style.left = `${(position * 100).toFixed(1)}%`;
  elements.micGateMarker.dataset.active = String(!isGateDisabled());
}

function refreshMicrophoneLevelMeter(db) {
  if (!elements.micLevelFill || !elements.micLevelTrack) return;

  const levelDb = Number.isFinite(db) ? clampGateThresholdDb(db) : GATE_THRESHOLD_MIN_DB;
  const position = getDbMeterPosition(levelDb);
  const gateOpen = isGateDisabled() || levelDb >= state.gateThresholdDb;
  elements.micLevelFill.style.transform = `scaleX(${position.toFixed(3)})`;
  elements.micLevelFill.dataset.state = gateOpen ? 'open' : 'closed';
  elements.micLevelTrack.setAttribute('aria-valuenow', String(Math.round(levelDb)));
  refreshGateMarker();
}

function persistMicrophoneDeviceId(deviceId) {
  state.microphoneDeviceId = deviceId || '';
  if (state.microphoneDeviceId) {
    localStorage.setItem(MICROPHONE_DEVICE_STORAGE_KEY, state.microphoneDeviceId);
  } else {
    localStorage.removeItem(MICROPHONE_DEVICE_STORAGE_KEY);
  }
}

function persistOutputDeviceId(deviceId) {
  state.outputDeviceId = deviceId || '';
  if (state.outputDeviceId) {
    localStorage.setItem(OUTPUT_DEVICE_STORAGE_KEY, state.outputDeviceId);
  } else {
    localStorage.removeItem(OUTPUT_DEVICE_STORAGE_KEY);
  }
}

function persistOutputMuted() {
  localStorage.setItem(OUTPUT_MUTED_STORAGE_KEY, String(state.outputMuted));
}

function supportsAudioOutputSelection() {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}

function getRoomIdFromPath() {
  const match = window.location.pathname.match(/^\/r\/([A-Za-z0-9_-]{3,48})\/?$/);
  return match ? match[1] : '';
}

function createPeerId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function createSessionToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hideScreens() {
  elements.startScreen.hidden = true;
  elements.roomScreen.hidden = true;
  elements.notFoundScreen.hidden = true;
}

function showStartScreen() {
  document.body.dataset.screen = 'start';
  document.title = 'Voice Room';
  hideScreens();
  elements.startScreen.hidden = false;
  elements.statusPill.hidden = true;
  updateNameStatuses();
}

async function showRoomRoute() {
  document.body.dataset.screen = 'checking';
  hideScreens();
  elements.statusPill.hidden = true;

  const exists = await checkRoomExists(state.roomId);
  if (!exists) {
    showRoomNotFound();
    return;
  }

  if (!ensureNameForRoomLink()) {
    window.location.href = '/';
    return;
  }

  showRoomScreen();
  refreshDevices().catch(() => {});
}

function showRoomScreen() {
  document.body.dataset.screen = 'room';
  document.title = `${state.roomId} · Voice Room`;
  elements.roomTitle.textContent = state.roomId;
  hideScreens();
  elements.roomScreen.hidden = false;
  elements.statusPill.hidden = true;

  updateNameStatuses();
  refreshCallControls();
  refreshScreenControls();
  refreshScreenStage();
  refreshParticipantState();
  autoJoinRoom();
}

function showRoomNotFound() {
  leaveRoom();
  document.body.dataset.screen = 'not-found';
  document.title = 'Комната не найдена · Voice Room';
  elements.missingRoomCode.textContent = state.roomId || getMissingRoomLabel();
  hideScreens();
  elements.notFoundScreen.hidden = false;
  elements.statusPill.hidden = true;
}

function getMissingRoomLabel() {
  try {
    return decodeURIComponent(window.location.pathname).replace(/^\/r\/?/, '').replace(/\/$/, '') || 'room';
  } catch (error) {
    return 'room';
  }
}

function saveStartName(event) {
  event.preventDefault();
  saveNameFromInput(elements.startNameInput);
}

async function createRoomFromStart() {
  if (!requireSavedName(elements.startNameInput)) return;

  const previousLabel = elements.createRoomButton.textContent;
  elements.createRoomButton.disabled = true;
  elements.createRoomButton.textContent = 'Создаём...';
  try {
    const proof = await createRoomProof();
    const room = await postJson('/rooms', { proof });
    openRoom(room.roomId);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Не удалось создать комнату');
  } finally {
    elements.createRoomButton.textContent = previousLabel;
    elements.createRoomButton.disabled = false;
  }
}

async function createRoomProof() {
  const challenge = await fetchJson('/pow-challenge');
  if (!challenge.required) return null;

  if (!window.crypto?.subtle || typeof TextEncoder !== 'function') {
    throw new Error('Откройте сайт через HTTPS или localhost');
  }

  return {
    challenge: challenge.challenge,
    nonce: await solveProofOfWork(challenge.challenge, challenge.difficulty, challenge.expiresAt)
  };
}

async function solveProofOfWork(challenge, difficulty, expiresAt) {
  const targetBits = Number(difficulty);
  const expiresAtMs = Number(expiresAt);
  if (typeof challenge !== 'string' || !challenge) throw new Error('Не удалось создать комнату');
  if (!Number.isInteger(targetBits) || targetBits < 0 || targetBits > 32) throw new Error('Не удалось создать комнату');
  if (!Number.isFinite(expiresAtMs)) throw new Error('Не удалось создать комнату');

  const encoder = new TextEncoder();
  let nonce = 0;
  while (Date.now() < expiresAtMs) {
    for (let index = 0; index < ROOM_PROOF_BATCH_SIZE; index += 1) {
      const data = encoder.encode(`${challenge}:${nonce}`);
      const hash = new Uint8Array(await window.crypto.subtle.digest('SHA-256', data));
      if (hasLeadingZeroBits(hash, targetBits)) return nonce;
      nonce += 1;
    }
    await waitForUi();
  }

  throw new Error('Проверка создания комнаты истекла');
}

function hasLeadingZeroBits(bytes, bits) {
  const fullBytes = Math.floor(bits / 8);
  const remainingBits = bits % 8;

  for (let index = 0; index < fullBytes; index += 1) {
    if (bytes[index] !== 0) return false;
  }

  if (remainingBits === 0) return true;
  const mask = 0xff << (8 - remainingBits);
  return (bytes[fullBytes] & mask) === 0;
}

function waitForUi() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function joinRoomByCode() {
  if (!requireSavedName(elements.startNameInput)) return;

  const roomId = extractRoomId(elements.roomCodeInput.value);
  if (!roomId) {
    showToast('Введите код комнаты');
    elements.roomCodeInput.focus();
    return;
  }

  openRoom(roomId);
}

function handleRoomCodeKeydown(event) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  joinRoomByCode();
}

function openRoom(roomId) {
  window.location.href = `/r/${encodeURIComponent(roomId)}`;
}

function ensureNameForRoomLink() {
  if (state.savedName) return true;

  const promptedName = cleanDisplayName(window.prompt('Как вас зовут?'));
  if (!promptedName) return false;

  persistName(promptedName);
  return true;
}

async function joinRoom(event) {
  event?.preventDefault();
  if (state.joined || state.connecting) return;
  requireLiveKitSdk();

  state.connecting = true;
  state.localConnectionQuality = 'unknown';
  state.localPingMs = null;
  refreshLocalNetworkIndicator();
  elements.muteButton.disabled = true;
  setStatus('connecting', 'соединение');
  refreshCallControls();

  try {
    const exists = await checkRoomExists(state.roomId);
    if (!exists) {
      showRoomNotFound();
      return;
    }

    if (state.outputMuted) {
      state.micMutedBeforeOutputMute = state.muted;
      state.muted = true;
    }

    setLocalMicrophoneCapture(await openLocalMicrophone());
    await refreshDevices();

    const name = getDisplayName();
    state.self = createParticipant({
      id: state.peerId,
      deafened: state.outputMuted,
      isLocal: true,
      joinedAt: Date.now(),
      muted: state.muted,
      name
    });
    attachMeter(state.self, state.localStream);
    updatePeerStatus(state.self);

    state.eventSource = new EventSource(
      `/events?room=${encodeURIComponent(state.roomId)}&peer=${encodeURIComponent(state.peerId)}&token=${encodeURIComponent(state.sessionToken)}&name=${encodeURIComponent(name)}`
    );
    state.eventSource.onopen = () => {
      if (state.joined) setStatus('connected', '');
    };
    state.eventSource.onmessage = handleServerMessage;
    state.eventSource.onerror = () => {
      if (state.joined) setStatus('connecting', 'переподключение');
    };

    await connectLiveKitRoom(name);
    state.joined = true;
    if (state.muted || state.outputMuted) postState().catch(() => {});
    refreshCallControls();
    refreshScreenControls();
    startMeters();
    startPeerLatencyStats();
    startSpeakingStats();
    playPeerCue('join');
  } catch (error) {
    console.error(error);
    showToast(formatJoinError(error));
    setStatus('error', 'ошибка');
    state.eventSource?.close();
    state.eventSource = null;
    await disconnectLiveKitRoom();
    state.self?.node.remove();
    state.self = null;
    stopLocalStream();
    refreshParticipantState();
  } finally {
    state.connecting = false;
    elements.muteButton.disabled = false;
    refreshCallControls();
    refreshScreenControls();
  }
}

function autoJoinRoom() {
  if (state.autoJoinStarted) return;
  state.autoJoinStarted = true;

  window.setTimeout(() => {
    if (!state.roomId || state.joined || state.connecting) return;

    joinRoom().catch((error) => {
      console.error(error);
      showToast('Не удалось подключиться');
      setStatus('error', 'ошибка');
    });
  }, 0);
}

function requireLiveKitSdk() {
  if (!LiveKitRoom || !RoomEvent || !Track) {
    throw new Error('LiveKit SDK не загрузился. Проверьте сборку и CSP.');
  }
}

function formatJoinError(error) {
  const message = error?.message || String(error || '');
  if (/signal connection|failed to fetch/i.test(message)) {
    return 'LiveKit недоступен: проверьте LIVEKIT_URL=ws://127.0.0.1:7880 и перезапустите VoiceRoom';
  }
  return message || 'Не удалось подключиться';
}

async function connectLiveKitRoom(name) {
  const credentials = await postJson('/livekit-token', {
    name,
    peerId: state.peerId,
    roomId: state.roomId,
    sessionToken: state.sessionToken
  });

  const room = await connectLiveKitWithFallback(credentials);

  await publishLocalMicrophone();
  syncLiveKitParticipants(room);
}

async function connectLiveKitWithFallback(credentials) {
  const urls = getLiveKitConnectUrls(credentials.url);
  let lastError = null;

  for (const url of urls) {
    const room = new LiveKitRoom({
      adaptiveStream: true,
      dynacast: true
    });
    state.livekitRoom = room;
    bindLiveKitRoomEvents(room);

    try {
      await room.connect(url, credentials.token, {
        autoSubscribe: false
      });
      logLocalLiveKitDebug('info', `LiveKit connected to ${url}`);
      return room;
    } catch (error) {
      lastError = error;
      logLocalLiveKitDebug('warn', `LiveKit connect failed for ${url}`, error);
      state.livekitRoom = null;
      await room.disconnect(false).catch(() => {});
    }
  }

  throw new Error(`${lastError?.message || 'LiveKit connection failed'} (${urls.join(', ')})`);
}

function getLiveKitConnectUrls(url) {
  const urls = [url];
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'localhost') {
      parsed.hostname = '127.0.0.1';
      urls.push(parsed.toString());
    } else if (parsed.hostname === '127.0.0.1') {
      parsed.hostname = 'localhost';
      urls.push(parsed.toString());
    }
  } catch {
    // Keep the backend-provided URL as-is.
  }
  return [...new Set(urls)];
}

function logLocalLiveKitDebug(level, ...args) {
  if (!['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)) return;
  console[level]?.(...args);
}

function bindLiveKitRoomEvents(room) {
  room.on(RoomEvent.Connected, () => {
    setStatus('connected', '');
  });
  room.on(RoomEvent.Reconnecting, () => {
    if (state.joined || state.connecting) setStatus('connecting', 'переподключение');
  });
  room.on(RoomEvent.Reconnected, () => {
    if (state.joined || state.connecting) setStatus('connected', '');
  });
  room.on(RoomEvent.Disconnected, () => {
    if (state.joined) setStatus('connecting', 'соединение потеряно');
  });
  room.on(RoomEvent.ParticipantConnected, (participant) => {
    createLiveKitParticipant(participant);
    playPeerCue('join');
    refreshParticipantState();
  });
  room.on(RoomEvent.ParticipantDisconnected, (participant) => {
    const hadPeer = state.peers.has(participant.identity);
    removePeer(participant.identity);
    if (hadPeer) playPeerCue('leave');
    refreshParticipantState();
  });
  room.on(RoomEvent.TrackPublished, (publication, participant) => {
    const peer = createLiveKitParticipant(participant);
    updateLiveKitPublicationState(peer, publication);
    syncLiveKitPublicationSubscription(peer, publication);
  });
  room.on(RoomEvent.TrackUnpublished, (publication, participant) => {
    handleLiveKitTrackUnpublished(publication, participant);
  });
  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    handleLiveKitTrackSubscribed(track, publication, participant);
  });
  room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
    handleLiveKitTrackUnsubscribed(track, publication, participant);
  });
  room.on(RoomEvent.TrackMuted, (publication, participant) => {
    const peer = createLiveKitParticipant(participant);
    if (isMicrophonePublication(publication)) {
      updateParticipant({ id: peer.id, muted: true });
    }
  });
  room.on(RoomEvent.TrackUnmuted, (publication, participant) => {
    const peer = createLiveKitParticipant(participant);
    if (isMicrophonePublication(publication)) {
      updateParticipant({ id: peer.id, muted: false });
    }
  });
  room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
    const activeIds = new Set(speakers.map((participant) => participant.identity));
    for (const peer of state.peers.values()) {
      setParticipantSpeaking(peer, activeIds.has(peer.id));
    }
  });
  room.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
    if (!participant) return;
    if (participant.isLocal) {
      state.localConnectionQuality = quality || 'unknown';
      refreshLocalNetworkIndicator();
      return;
    }
    const peer = createLiveKitParticipant(participant);
    peer.connectionQuality = quality || 'unknown';
  });
  room.on(RoomEvent.ParticipantNameChanged, (name, participant) => {
    updateParticipant({ id: participant.identity, name: name || participant.identity });
  });
}

function syncLiveKitParticipants(room) {
  room.remoteParticipants.forEach((participant) => {
    const peer = createLiveKitParticipant(participant);
    participant.trackPublications.forEach((publication) => {
      updateLiveKitPublicationState(peer, publication);
      syncLiveKitPublicationSubscription(peer, publication);
      if (publication.track && publication.isSubscribed) {
        handleLiveKitTrackSubscribed(publication.track, publication, participant);
      }
    });
  });
}

function createLiveKitParticipant(participant) {
  const peer = createParticipant({
    deafened: getLiveKitBooleanAttribute(participant, 'deafened'),
    id: participant.identity,
    isLocal: participant.isLocal || participant.identity === state.peerId,
    joinedAt: participant.joinedAt ? participant.joinedAt.getTime() : Date.now(),
    muted: !participant.isMicrophoneEnabled || getLiveKitBooleanAttribute(participant, 'muted'),
    name: participant.name || participant.identity,
    screen: participant.isScreenShareEnabled
  });
  peer.livekitParticipant = participant;
  return peer;
}

function getLiveKitBooleanAttribute(participant, name) {
  return participant?.attributes?.[name] === 'true';
}

async function publishLocalMicrophone() {
  if (!state.livekitRoom || !state.localStream) return;
  const [track] = state.localStream.getAudioTracks();
  if (!track) throw new Error('Браузер не отдал аудио-трек');

  state.localMicPublication = await state.livekitRoom.localParticipant.publishTrack(track, {
    audioPreset: { maxBitrate: MICROPHONE_AUDIO_BITRATE },
    dtx: true,
    name: 'microphone',
    red: true,
    source: Track.Source.Microphone
  });
  await syncLocalMicrophonePublicationMuted();
}

async function unpublishLocalMicrophone(stopOnUnpublish = false) {
  if (!state.livekitRoom || !state.localMicPublication?.track) {
    state.localMicPublication = null;
    return;
  }

  await state.livekitRoom.localParticipant.unpublishTrack(state.localMicPublication.track, stopOnUnpublish);
  state.localMicPublication = null;
}

async function syncLocalMicrophonePublicationMuted() {
  const publication = state.localMicPublication;
  if (!publication) return;

  if (state.muted) {
    await publication.mute();
  } else {
    await publication.unmute();
  }
}

async function publishLocalScreenTracks() {
  if (!state.livekitRoom || !state.localScreenStream) return;
  const profile = getScreenProfile(state.localScreenProfileId);
  state.localScreenPublications.clear();

  for (const track of state.localScreenStream.getTracks()) {
    const publication = await state.livekitRoom.localParticipant.publishTrack(track, {
      audioPreset: track.kind === 'audio' ? { maxBitrate: SCREEN_AUDIO_BITRATE } : undefined,
      name: track.kind === 'video' ? 'screen' : 'screen-audio',
      screenShareEncoding: track.kind === 'video'
        ? { maxBitrate: profile.videoBitrate, maxFramerate: profile.frameRate }
        : undefined,
      source: track.kind === 'video' ? Track.Source.ScreenShare : Track.Source.ScreenShareAudio,
      stream: state.localScreenStream.id
    });
    state.localScreenPublications.set(track.id, publication);
  }
}

async function unpublishLocalScreenTracks(stopOnUnpublish = false) {
  if (!state.livekitRoom || state.localScreenPublications.size === 0) {
    state.localScreenPublications.clear();
    return;
  }

  const publications = [...state.localScreenPublications.values()];
  state.localScreenPublications.clear();
  await Promise.allSettled(
    publications
      .map((publication) => publication.track)
      .filter(Boolean)
      .map((track) => state.livekitRoom.localParticipant.unpublishTrack(track, stopOnUnpublish))
  );
}

async function disconnectLiveKitRoom() {
  const room = state.livekitRoom;
  state.livekitRoom = null;
  state.localMicPublication = null;
  state.localScreenPublications.clear();
  if (!room) return;

  try {
    room.removeAllListeners?.();
    await room.disconnect(false);
  } catch (error) {
    console.warn('LiveKit disconnect failed', error);
  }
}

function updateLiveKitPublicationState(peer, publication) {
  if (isScreenPublication(publication)) {
    peer.screen = true;
    peer.screenAudio = peer.screenAudio || isScreenAudioPublication(publication);
    peer.node.dataset.screen = 'true';
    updatePeerStatus(peer);
    refreshScreenAction(peer);
  }
  if (isMicrophonePublication(publication)) {
    peer.muted = publication.isMuted;
    peer.node.dataset.muted = String(peer.muted);
  }
}

function syncLiveKitPublicationSubscription(peer, publication) {
  if (!publication?.setSubscribed) return;

  if (isMicrophonePublication(publication)) {
    publication.setSubscribed(true);
    return;
  }

  if (isScreenPublication(publication)) {
    publication.setSubscribed(state.viewedScreenPeerId === peer.id);
  }
}

function syncLiveKitScreenSubscriptions(peer) {
  const participant = peer?.livekitParticipant;
  if (!participant) return;

  participant.trackPublications.forEach((publication) => {
    if (isScreenPublication(publication)) {
      syncLiveKitPublicationSubscription(peer, publication);
    }
  });
}

function handleLiveKitTrackSubscribed(track, publication, participant) {
  const peer = createLiveKitParticipant(participant);
  updateLiveKitPublicationState(peer, publication);

  const mediaTrack = track.mediaStreamTrack;
  const stream = track.mediaStream || new MediaStream([mediaTrack]);
  if (isScreenPublication(publication)) {
    attachRemoteScreenStream(peer, stream);
    return;
  }

  if (isMicrophonePublication(publication)) {
    attachRemoteTrack(peer, mediaTrack, stream, track.receiver);
  }
}

function handleLiveKitTrackUnsubscribed(track, publication, participant) {
  const peer = state.peers.get(participant.identity);
  if (!peer) return;

  if (isScreenPublication(publication)) {
    detachRemoteScreen(peer);
    return;
  }

  if (isMicrophonePublication(publication)) {
    detachRemoteAudioTrack(peer, track.mediaStreamTrack.id);
    peer.micReceiver = null;
  }
}

function handleLiveKitTrackUnpublished(publication, participant) {
  const peer = state.peers.get(participant.identity);
  if (!peer) return;

  if (isScreenPublication(publication)) {
    peer.screen = participant.isScreenShareEnabled;
    peer.screenAudio = participant.trackPublications
      ? [...participant.trackPublications.values()].some(isScreenAudioPublication)
      : false;
    peer.node.dataset.screen = String(peer.screen);
    if (!peer.screen) detachRemoteScreen(peer);
    refreshScreenAction(peer);
  }
}

function isMicrophonePublication(publication) {
  return publication?.source === Track.Source.Microphone;
}

function isScreenPublication(publication) {
  return publication?.source === Track.Source.ScreenShare || publication?.source === Track.Source.ScreenShareAudio;
}

function isScreenAudioPublication(publication) {
  return publication?.source === Track.Source.ScreenShareAudio;
}

async function openMicrophone(mode = state.noiseMode) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Браузер не дал доступ к микрофону. Нужен HTTPS или localhost.');
  }

  const noiseMode = NOISE_MODES[getNoiseMode(mode)];
  const deviceId = state.microphoneDeviceId || elements.deviceSelect.value;
  return navigator.mediaDevices.getUserMedia({
    audio: {
      autoGainControl: true,
      channelCount: 1,
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: true,
      noiseSuppression: noiseMode.nativeNoiseSuppression
    },
    video: false
  });
}

async function openLocalMicrophone() {
  const mode = state.noiseMode;
  const rawStream = await openMicrophone(mode);

  if (mode !== 'rnnoise') {
    return applyNoiseGateToCapture({
      mode,
      processor: null,
      rawStream,
      stream: rawStream
    });
  }

  try {
    return await applyNoiseGateToCapture(await createNoiseSuppressedStream(rawStream));
  } catch (error) {
    console.warn('RNNoise unavailable', error);
    stopStream(rawStream);
    setNoiseMode('browser');
    showToast('RNNoise недоступен, включен браузерный шумодав');
    const fallbackStream = await openMicrophone('browser');
    return applyNoiseGateToCapture({
      mode: 'browser',
      processor: null,
      rawStream: fallbackStream,
      stream: fallbackStream
    });
  }
}

async function applyNoiseGateToCapture(capture) {
  if (getGateThresholdAmplitude() <= 0) return capture;

  try {
    const gated = await createNoiseGatedStream(capture.stream);
    return {
      ...capture,
      processor: combineMicrophoneProcessors(capture.processor, gated.processor),
      stream: gated.stream
    };
  } catch (error) {
    console.warn('Noise gate unavailable', error);
    showToast('Гейт недоступен, микрофон работает без него');
    return capture;
  }
}

async function createNoiseGatedStream(inputStream) {
  const threshold = getGateThresholdAmplitude();
  if (threshold <= 0) {
    return {
      processor: null,
      stream: inputStream
    };
  }

  const context = createProcessingAudioContext();
  try {
    const source = context.createMediaStreamSource(inputStream);
    const gate = await createNoiseGateNode(context, threshold);
    const destination = context.createMediaStreamDestination();

    source.connect(gate);
    gate.connect(destination);
    await context.resume();

    const [inputTrack] = inputStream.getAudioTracks();
    const [outputTrack] = destination.stream.getAudioTracks();
    if (!outputTrack) {
      throw new Error('Гейт не вернул аудио-трек');
    }
    outputTrack.enabled = inputTrack?.enabled ?? true;
    if ('contentHint' in outputTrack) outputTrack.contentHint = 'speech';

    return {
      processor: {
        context,
        destination,
        node: gate,
        source
      },
      stream: destination.stream
    };
  } catch (error) {
    context.close().catch(() => {});
    throw error;
  }
}

async function createNoiseGateNode(context, threshold) {
  if (window.AudioWorkletNode && context.audioWorklet?.addModule) {
    try {
      await context.audioWorklet.addModule(AUDIO_GATE_WORKLET_URL);
      return new AudioWorkletNode(context, 'voice-room-noise-gate', {
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: createNoiseGateOptions(threshold)
      });
    } catch (error) {
      console.warn('AudioWorklet gate unavailable, using ScriptProcessor', error);
    }
  }

  return createScriptProcessorNoiseGateNode(context, threshold);
}

function createNoiseGateOptions(threshold) {
  return {
    attackMs: GATE_ATTACK_MS,
    closeRatio: GATE_CLOSE_RATIO,
    detectorAttackMs: GATE_DETECTOR_ATTACK_MS,
    detectorReleaseMs: GATE_DETECTOR_RELEASE_MS,
    floorGain: GATE_FLOOR_GAIN,
    holdMs: GATE_HOLD_MS,
    releaseMs: GATE_RELEASE_MS,
    threshold
  };
}

function createScriptProcessorNoiseGateNode(context, threshold) {
  if (typeof context.createScriptProcessor !== 'function') {
    throw new Error('ScriptProcessor недоступен');
  }

  const gate = context.createScriptProcessor(GATE_PROCESSOR_BUFFER_SIZE, 1, 1);
  const envelope = createNoiseGateEnvelope(threshold, context.sampleRate || 48000);
  gate.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const output = event.outputBuffer.getChannelData(0);

    for (let index = 0; index < input.length; index += 1) {
      output[index] = processNoiseGateSample(input[index] || 0, envelope);
    }
  };

  return gate;
}

function createNoiseGateEnvelope(threshold, sampleRate) {
  return {
    attackCoefficient: getGateSmoothingCoefficient(GATE_ATTACK_MS, sampleRate),
    closeThreshold: threshold * GATE_CLOSE_RATIO,
    detector: 0,
    detectorAttackCoefficient: getGateSmoothingCoefficient(GATE_DETECTOR_ATTACK_MS, sampleRate),
    detectorReleaseCoefficient: getGateSmoothingCoefficient(GATE_DETECTOR_RELEASE_MS, sampleRate),
    floorGain: GATE_FLOOR_GAIN,
    gain: threshold > 0 ? GATE_FLOOR_GAIN : 1,
    holdRemaining: 0,
    holdSamples: Math.round(GATE_HOLD_MS * sampleRate / 1000),
    open: false,
    releaseCoefficient: getGateSmoothingCoefficient(GATE_RELEASE_MS, sampleRate),
    threshold
  };
}

function processNoiseGateSample(sample, envelope) {
  const level = Math.abs(sample);
  const detectorCoefficient = level > envelope.detector
    ? envelope.detectorAttackCoefficient
    : envelope.detectorReleaseCoefficient;
  envelope.detector += (level - envelope.detector) * detectorCoefficient;

  if (envelope.detector >= envelope.threshold) {
    envelope.open = true;
    envelope.holdRemaining = envelope.holdSamples;
  } else if (envelope.open && envelope.detector < envelope.closeThreshold) {
    if (envelope.holdRemaining > 0) {
      envelope.holdRemaining -= 1;
    } else {
      envelope.open = false;
    }
  }

  const targetGain = envelope.open ? 1 : envelope.floorGain;
  const gainCoefficient = targetGain > envelope.gain
    ? envelope.attackCoefficient
    : envelope.releaseCoefficient;
  envelope.gain += (targetGain - envelope.gain) * gainCoefficient;

  return sample * envelope.gain;
}

function getGateSmoothingCoefficient(milliseconds, sampleRate) {
  const duration = Math.max(0.001, milliseconds / 1000);
  return 1 - Math.exp(-1 / (duration * sampleRate));
}

async function createNoiseSuppressedStream(rawStream) {
  if (!window.AudioContext || !window.AudioWorkletNode) {
    throw new Error('AudioWorklet недоступен');
  }

  const context = createProcessingAudioContext();
  try {
    const { RNNoiseNode, rnnoise_loadAssets: loadAssets } = await loadRnnoiseModule();
    await RNNoiseNode.register(
      context,
      loadAssets({
        moduleSrc: `${RNNOISE_ASSET_BASE}rnnoise.wasm`,
        scriptSrc: `${RNNOISE_ASSET_BASE}rnnoise.worklet.js`
      })
    );

    const source = context.createMediaStreamSource(rawStream);
    const rnnoise = new RNNoiseNode(context);
    const destination = context.createMediaStreamDestination();
    source.connect(rnnoise);
    rnnoise.connect(destination);
    await context.resume();

    const [inputTrack] = rawStream.getAudioTracks();
    const [outputTrack] = destination.stream.getAudioTracks();
    if (!outputTrack) {
      throw new Error('RNNoise не вернул аудио-трек');
    }
    outputTrack.enabled = inputTrack?.enabled ?? true;
    if ('contentHint' in outputTrack) outputTrack.contentHint = 'speech';

    return {
      mode: 'rnnoise',
      processor: {
        context,
        destination,
        node: rnnoise,
        source
      },
      rawStream,
      stream: destination.stream
    };
  } catch (error) {
    context.close().catch(() => {});
    throw error;
  }
}

async function loadRnnoiseModule() {
  rnnoiseModulePromise ||= import(`${RNNOISE_ASSET_BASE}rnnoise.mjs`);
  return rnnoiseModulePromise;
}

function createProcessingAudioContext() {
  try {
    return new AudioContext({ sampleRate: 48000 });
  } catch {
    return new AudioContext();
  }
}

function getLocalMicrophoneCapture() {
  return {
    processor: state.micProcessor,
    rawStream: state.localRawStream,
    stream: state.localStream
  };
}

function setLocalMicrophoneCapture(capture) {
  state.localStream = capture.stream;
  state.localRawStream = capture.rawStream;
  state.micProcessor = capture.processor;
  setMicrophoneCaptureEnabled(capture, !state.muted);
}

function setMicrophoneCaptureEnabled(capture, enabled) {
  const tracks = new Set([
    ...(capture.stream?.getAudioTracks() || []),
    ...(capture.rawStream?.getAudioTracks() || [])
  ]);
  for (const track of tracks) {
    track.enabled = enabled;
  }
}

function stopMicrophoneCapture(capture) {
  const processors = getMicrophoneProcessors(capture.processor);
  for (const processor of processors) {
    disconnectAudioNode(processor.source);
    disconnectAudioNode(processor.node);
    disconnectAudioNode(processor.destination);
    processor.context?.close().catch(() => {});
  }

  const streams = new Set([
    capture.stream,
    capture.rawStream,
    ...processors.map((processor) => processor.destination?.stream)
  ].filter(Boolean));
  for (const stream of streams) stopStream(stream);
}

function combineMicrophoneProcessors(currentProcessor, nextProcessor) {
  if (!currentProcessor) return nextProcessor;
  return [...getMicrophoneProcessors(currentProcessor), nextProcessor].filter(Boolean);
}

function getMicrophoneProcessors(processor) {
  if (!processor) return [];
  return Array.isArray(processor) ? processor.filter(Boolean) : [processor];
}

function disconnectAudioNode(node) {
  try {
    node?.disconnect();
  } catch {
    // The graph may already be partially disconnected after a failed worklet setup.
  }
}

async function openScreenShare(profile) {
  if (hasDesktopCapture()) {
    return openDesktopScreenShare(profile);
  }

  if (isDesktopApp()) {
    throw new Error('Desktop-оболочка не загрузила модуль выбора экрана. Перезапустите приложение из новой сборки.');
  }

  return openBrowserScreenShare(profile);
}

function hasDesktopCapture() {
  return Boolean(window.voiceRoomDesktopCapture?.getSources);
}

function isDesktopApp() {
  return Boolean(window.voiceRoomRuntime?.isDesktop);
}

async function openBrowserScreenShare(profile) {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('Браузер не поддерживает демонстрацию экрана. Нужен HTTPS или localhost.');
  }

  const stream = await navigator.mediaDevices.getDisplayMedia(createBrowserDisplayMediaConstraints(profile, {
    suppressLocalAudioPlayback: false
  }));

  await applyScreenCaptureProfile(stream, profile);
  return stream;
}

function createBrowserDisplayMediaConstraints(profile, options = {}) {
  const { audio = true, suppressLocalAudioPlayback = false } = options;
  const video = {
    frameRate: { ideal: profile.frameRate, max: profile.frameRate },
    height: { ideal: profile.height, max: profile.height },
    width: { ideal: profile.width, max: profile.width }
  };

  if (!audio) {
    return {
      audio: false,
      video
    };
  }

  return {
    audio: {
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
      suppressLocalAudioPlayback
    },
    video
  };
}

async function openDesktopScreenShare(profile) {
  if (!navigator.mediaDevices?.getDisplayMedia && !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Desktop-оболочка не дала доступ к захвату экрана.');
  }

  const source = await selectDesktopCaptureSource();
  let stream = null;
  let audioCaptureError = null;

  try {
    stream = await openDesktopStream(source.id, profile, { audio: true, audioMode: 'loopback' });
  } catch (error) {
    if (isCaptureCancelled(error)) {
      setLocalAppAudioSuppressed(false);
      throw error;
    }
    audioCaptureError = error;
    console.warn('Desktop audio capture unavailable, retrying without audio', error);
    try {
      stream = await openDesktopStream(source.id, profile, { audio: false, audioMode: 'none' });
    } catch (videoError) {
      throw mergeDesktopCaptureErrors(audioCaptureError, videoError);
    }
  }

  await applyScreenCaptureProfile(stream, profile);
  return stream;
}

async function openDesktopStream(sourceId, profile, options = {}) {
  const withAudio = options.audio !== false;
  const attempts = createDesktopCaptureAttempts(sourceId, withAudio);
  const errors = [];

  for (const attempt of attempts) {
    try {
      return await attempt.open();
    } catch (error) {
      errors.push({ error, method: attempt.method });
      console.warn(`Desktop capture failed via ${attempt.method}`, error);
    }
  }

  if (errors.length) throw createDesktopCaptureError(errors);
  throw new Error('Desktop-оболочка не поддерживает захват экрана в этой сборке.');
}

function mergeDesktopCaptureErrors(...errors) {
  const attemptDetails = errors.flatMap((error) => error?.captureAttemptDetails || [{ error, method: 'unknown' }]);
  return createDesktopCaptureError(attemptDetails);
}

function createDesktopCaptureError(attemptDetails) {
  const lastError = attemptDetails.at(-1)?.error;
  const error = new Error(formatDesktopCaptureError(attemptDetails));
  error.name = lastError?.name || 'DesktopCaptureError';
  error.captureAttemptDetails = attemptDetails;
  return error;
}

function formatDesktopCaptureError(attemptDetails) {
  const platform = window.voiceRoomRuntime?.platform || 'unknown';
  const displayMedia = navigator.mediaDevices?.getDisplayMedia ? 'yes' : 'no';
  const userMedia = navigator.mediaDevices?.getUserMedia ? 'yes' : 'no';
  const attempts = attemptDetails.map(formatCaptureAttemptError).join('\n');

  return [
    'Не удалось запустить демонстрацию экрана.',
    `Среда: desktop ${platform}, getDisplayMedia=${displayMedia}, getUserMedia=${userMedia}.`,
    'Попытки:',
    attempts
  ].join('\n');
}

function formatCaptureAttemptError({ error, method }) {
  return `- ${method}: ${formatCaptureError(error)}`;
}

function formatCaptureError(error) {
  if (!error) return 'unknown error';

  const name = error.name || error.constructor?.name || 'Error';
  const message = error.message || String(error);
  const details = [];
  if (error.constraint) details.push(`constraint=${error.constraint}`);
  if (error.code) details.push(`code=${error.code}`);

  return [name, message, ...details].join(': ');
}

function createDesktopCaptureAttempts(sourceId, withAudio) {
  const attempts = [];

  if (navigator.mediaDevices?.getDisplayMedia && window.voiceRoomDesktopCapture?.selectSource) {
    attempts.push({
      method: withAudio ? 'getDisplayMedia-loopback' : 'getDisplayMedia-video',
      open: () => openDesktopDisplayMediaStream(sourceId, withAudio)
    });
  }

  if (navigator.mediaDevices?.getUserMedia) {
    attempts.push({
      method: withAudio ? 'getUserMedia-desktop-audio' : 'getUserMedia-desktop-video',
      open: () => navigator.mediaDevices.getUserMedia(createDesktopMediaConstraints(sourceId, withAudio))
    });
  }

  return attempts;
}

async function openDesktopDisplayMediaStream(sourceId, withAudio) {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('Desktop-оболочка не поддерживает display media capture.');
  }

  if (!window.voiceRoomDesktopCapture?.selectSource) {
    throw new Error('Desktop-оболочка не дала доступ к выбору источника экрана.');
  }

  await window.voiceRoomDesktopCapture.selectSource(sourceId, withAudio ? 'loopback' : 'none');
  return navigator.mediaDevices.getDisplayMedia({
    audio: withAudio,
    video: true
  });
}

function createDesktopMediaConstraints(sourceId, withAudio) {
  return {
    audio: withAudio
      ? {
          mandatory: {
            chromeMediaSource: 'desktop'
          }
        }
      : false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId
      }
    }
  };
}

async function selectDesktopCaptureSource() {
  const sources = await window.voiceRoomDesktopCapture.getSources();
  if (!sources.length) {
    throw new Error('Нет доступных источников экрана');
  }

  return showScreenSourcePicker(sources);
}

function showScreenSourcePicker(sources) {
  if (state.screenSourceRequest) cancelScreenSourcePicker();

  return new Promise((resolve, reject) => {
    state.screenSourceRequest = { reject, resolve };
    elements.screenSourceOptions.textContent = '';

    for (const source of sources) {
      const button = createScreenSourceButton(source);
      elements.screenSourceOptions.append(button);
    }

    elements.screenSourceDialog.hidden = false;
    window.setTimeout(() => {
      elements.screenSourceOptions.querySelector('button')?.focus();
    }, 0);
  });
}

function createScreenSourceButton(source) {
  const button = document.createElement('button');
  button.className = 'screen-source-option';
  button.type = 'button';
  button.setAttribute('aria-label', source.name);

  const preview = document.createElement('span');
  preview.className = 'screen-source-preview';
  if (source.thumbnail) {
    const image = document.createElement('img');
    image.alt = '';
    image.src = source.thumbnail;
    preview.append(image);
  } else {
    const fallback = document.createElement('span');
    fallback.className = 'screen-source-fallback';
    fallback.textContent = source.type === 'screen' ? 'Экран' : 'Окно';
    preview.append(fallback);
  }

  const label = document.createElement('span');
  label.className = 'screen-source-label';
  if (source.appIcon) {
    const icon = document.createElement('img');
    icon.alt = '';
    icon.src = source.appIcon;
    label.append(icon);
  }
  const name = document.createElement('span');
  name.textContent = source.name;
  label.append(name);

  button.append(preview, label);
  button.addEventListener('click', () => resolveScreenSourcePicker(source));
  return button;
}

function resolveScreenSourcePicker(source) {
  const request = closeScreenSourcePicker();
  request?.resolve(source);
}

function cancelScreenSourcePicker() {
  const request = closeScreenSourcePicker();
  request?.reject(createAbortError('Выбор источника отменен'));
}

function closeScreenSourcePicker() {
  const request = state.screenSourceRequest;
  state.screenSourceRequest = null;
  elements.screenSourceDialog.hidden = true;
  elements.screenSourceOptions.textContent = '';
  return request;
}

function closeScreenSourceOnBackdrop(event) {
  if (event.target === elements.screenSourceDialog) cancelScreenSourcePicker();
}

function closeScreenSourceOnEscape(event) {
  if (event.key !== 'Escape' || !state.screenSourceRequest) return;
  event.preventDefault();
  cancelScreenSourcePicker();
}

function createAbortError(message) {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

async function applyScreenCaptureProfile(stream, profile) {
  const [videoTrack] = stream.getVideoTracks();
  if (!videoTrack) return;

  if ('contentHint' in videoTrack) {
    videoTrack.contentHint = profile.contentHint;
  }

  try {
    await videoTrack.applyConstraints({
      frameRate: { max: profile.frameRate },
      height: { max: profile.height },
      width: { max: profile.width }
    });
  } catch (error) {
    console.warn('Screen capture constraints unavailable', error);
  }
}

async function handleScreenButtonClick() {
  if (state.localScreenStream) {
    await stopScreenShare();
    return;
  }

  toggleScreenProfilePopover();
}

async function startScreenShare(profileId = state.localScreenProfileId) {
  if (!state.joined || state.connecting) {
    showToast('Сначала подключитесь к комнате');
    return;
  }
  if (state.localScreenStream) return;

  const profile = getScreenProfile(profileId);
  state.localScreenProfileId = profile.id;
  renderScreenProfileOptions();
  elements.screenButton.disabled = true;
  try {
    const stream = await openScreenShare(profile);
    const [videoTrack] = stream.getVideoTracks();
    if (!videoTrack) {
      stopStream(stream);
      showToast('Браузер не отдал видео экрана');
      return;
    }

    state.localScreenStream = stream;
    state.localScreenProfileId = profile.id;
    state.screenStopping = false;
    setLocalAppAudioSuppressed(false);
    videoTrack.addEventListener('ended', () => {
      stopScreenShare({ fromBrowser: true }).catch((error) => console.error(error));
    });
    await publishLocalScreenTracks();

    updateParticipant({
      id: state.peerId,
      muted: state.muted,
      name: getDisplayName(),
      screen: true,
      screenAudio: hasScreenAudio(),
      screenStreamId: stream.id
    });
    refreshScreenControls();
    refreshScreenStage();
    await postState();

    playStreamCue('start');
    showToast(hasScreenAudio() ? `Стрим запущен: ${profile.label}, звук включен` : `Стрим запущен: ${profile.label}, без звука`);
  } catch (error) {
    const cancelled = isCaptureCancelled(error);
    if (!cancelled) console.error(error);
    if (state.localScreenStream) {
      await stopScreenShare({ notify: false, quiet: true }).catch((cleanupError) => console.error(cleanupError));
    } else {
      setLocalAppAudioSuppressed(false);
    }
    showToast(
      cancelled ? 'Демонстрация отменена' : error.message || 'Не удалось показать экран',
      cancelled ? undefined : { duration: 12000, variant: 'error' }
    );
  } finally {
    elements.screenButton.disabled = false;
    refreshScreenControls();
  }
}

function isCaptureCancelled(error) {
  return error?.name === 'NotAllowedError' || error?.name === 'AbortError';
}

async function stopScreenShare(options = {}) {
  if (!state.localScreenStream || state.screenStopping) return;

  state.screenStopping = true;
  try {
    const { notify = true, quiet = false } = options;
    const previousStream = state.localScreenStream;
    state.localScreenStream = null;

    await unpublishLocalScreenTracks(false);
    stopStream(previousStream);
    setLocalAppAudioSuppressed(false);

    updateParticipant({
      id: state.peerId,
      muted: state.muted,
      name: getDisplayName(),
      screen: false,
      screenAudio: false,
      screenStreamId: ''
    });
    refreshScreenControls();
    refreshScreenStage();
    if (notify) await postState();
    if (!quiet) {
      playStreamCue('stop');
      showToast('Демонстрация остановлена');
    }
  } finally {
    state.screenStopping = false;
    refreshScreenControls();
  }
}

async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;

  const activeMicrophoneId = getActiveMicrophoneDeviceId();
  const currentMicrophoneId = state.microphoneDeviceId || elements.deviceSelect.value || activeMicrophoneId;
  const currentOutputId = state.outputDeviceId || elements.outputDeviceSelect.value;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const microphones = devices.filter((device) => device.kind === 'audioinput');
  const outputs = devices.filter((device) => device.kind === 'audiooutput');

  renderDeviceOptions(elements.deviceSelect, microphones, {
    defaultLabel: 'Системный',
    fallbackLabel: 'Микрофон',
    selectedId: currentMicrophoneId
  });
  if (currentMicrophoneId && !hasSelectValue(elements.deviceSelect, currentMicrophoneId)) {
    persistMicrophoneDeviceId('');
  } else if (hasSelectValue(elements.deviceSelect, currentMicrophoneId)) {
    elements.deviceSelect.value = currentMicrophoneId;
  }

  elements.outputDeviceSelect.disabled = !supportsAudioOutputSelection();
  renderDeviceOptions(elements.outputDeviceSelect, outputs, {
    defaultLabel: 'Системный',
    fallbackLabel: 'Динамик',
    selectedId: currentOutputId
  });
  if (currentOutputId && !hasSelectValue(elements.outputDeviceSelect, currentOutputId)) {
    persistOutputDeviceId('');
  } else if (hasSelectValue(elements.outputDeviceSelect, currentOutputId)) {
    elements.outputDeviceSelect.value = currentOutputId;
  }

  refreshOutputControls();
}

function renderDeviceOptions(select, devices, options) {
  const { defaultLabel, fallbackLabel, selectedId } = options;
  const renderedDeviceIds = new Set(['']);
  select.textContent = '';

  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = defaultLabel;
  select.append(defaultOption);

  devices.forEach((device, index) => {
    if (!device.deviceId || renderedDeviceIds.has(device.deviceId)) return;
    renderedDeviceIds.add(device.deviceId);
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || `${fallbackLabel} ${index + 1}`;
    select.append(option);
  });

  select.value = hasSelectValue(select, selectedId) ? selectedId : '';
}

function hasSelectValue(select, value) {
  return [...select.options].some((option) => option.value === value);
}

function getActiveMicrophoneDeviceId() {
  const [track] = (state.localRawStream || state.localStream)?.getAudioTracks() || [];
  return track?.getSettings?.().deviceId || '';
}

async function switchMicrophone(options = {}) {
  const {
    failureMessage = 'Не удалось переключить микрофон',
    refreshDeviceList = true,
    successMessage = 'Микрофон переключен'
  } = options;
  const previousDeviceId = state.microphoneDeviceId;
  persistMicrophoneDeviceId(elements.deviceSelect.value);
  refreshCallControls();
  if (!state.joined || !state.localStream) return false;

  let nextCapture = null;
  try {
    const previousCapture = getLocalMicrophoneCapture();
    nextCapture = await openLocalMicrophone();
    const [nextTrack] = nextCapture.stream.getAudioTracks();
    if (!nextTrack) throw new Error('Браузер не отдал аудио-трек');

    await unpublishLocalMicrophone(false);
    setLocalMicrophoneCapture(nextCapture);
    await publishLocalMicrophone();
    stopMicrophoneCapture(previousCapture);
    attachMeter(state.self, state.localStream);
    setParticipantSpeaking(state.self, false);
    if (refreshDeviceList) await refreshDevices();
    showToast(typeof successMessage === 'function' ? successMessage(nextCapture) : successMessage);
    return true;
  } catch (error) {
    console.error(error);
    if (nextCapture) stopMicrophoneCapture(nextCapture);
    persistMicrophoneDeviceId(previousDeviceId);
    if (hasSelectValue(elements.deviceSelect, previousDeviceId)) {
      elements.deviceSelect.value = previousDeviceId;
    }
    showToast(failureMessage);
    return false;
  }
}

async function switchNoiseMode() {
  const previousMode = state.noiseMode;
  setNoiseMode(elements.noiseModeSelect.value);

  if (!state.joined || !state.localStream) return;

  const switched = await switchMicrophone({
    failureMessage: 'Не удалось переключить шумодав',
    refreshDeviceList: false,
    successMessage: (capture) => `Шумодав: ${getNoiseModeLabel(capture.mode)}`
  });
  if (!switched) setNoiseMode(previousMode);
}

function updateGateThresholdFromSlider() {
  setGateThresholdDb(elements.gateThresholdSlider.value);

  window.clearTimeout(gateSwitchTimer);
  if (!state.joined || !state.localStream) return;

  gateSwitchTimer = window.setTimeout(() => {
    switchMicrophone({
      failureMessage: 'Не удалось применить гейт',
      refreshDeviceList: false,
      successMessage: isGateDisabled() ? 'Гейт выключен' : `Гейт: ${state.gateThresholdDb} dB`
    }).catch((error) => console.error(error));
  }, 280);
}

async function switchOutputDevice() {
  if (!supportsAudioOutputSelection()) {
    elements.outputDeviceSelect.value = '';
    persistOutputDeviceId('');
    showToast('Выбор динамика недоступен в этой среде');
    return;
  }

  const previousDeviceId = state.outputDeviceId;
  persistOutputDeviceId(elements.outputDeviceSelect.value);
  const synced = await syncAudioOutputDevices();
  if (!synced) {
    persistOutputDeviceId(previousDeviceId);
    if (hasSelectValue(elements.outputDeviceSelect, previousDeviceId)) {
      elements.outputDeviceSelect.value = previousDeviceId;
    }
    await syncAudioOutputDevices();
    showToast('Не удалось переключить динамик');
    return;
  }

  showToast('Динамик переключен');
}

function toggleOutputMute() {
  const nextOutputMuted = !state.outputMuted;
  if (nextOutputMuted) {
    state.micMutedBeforeOutputMute = state.muted;
  }

  playOutputCue(nextOutputMuted);
  state.outputMuted = nextOutputMuted;
  persistOutputMuted();

  if (state.localStream) {
    if (state.outputMuted) {
      setMicrophoneMuted(true, { playCue: false, post: false });
    } else if (!state.micMutedBeforeOutputMute) {
      setMicrophoneMuted(false, { playCue: false, post: false });
    }
  }

  refreshOutputControls();
  syncPlaybackMuteState();
  updateParticipant({
    deafened: state.outputMuted,
    id: state.peerId,
    muted: state.muted,
    name: getDisplayName()
  });
  postState().catch(() => {});
  if (!state.outputMuted) unlockAudio().catch(() => {});
}

function refreshOutputControls() {
  const label = state.outputMuted ? 'Включить звук' : 'Выключить звук';
  elements.outputText.textContent = label;
  elements.outputButton.setAttribute('aria-label', label);
  elements.outputButton.setAttribute('aria-pressed', String(state.outputMuted));
  elements.outputButton.dataset.state = state.outputMuted ? 'muted' : 'live';
  elements.outputDeviceSelect.disabled = !supportsAudioOutputSelection();
}

function syncPlaybackMuteState() {
  syncRemoteAudioPlayback();
  syncScreenVideoAudio();
  if (isAppPlaybackMuted()) elements.soundButton.hidden = true;
}

function syncRemoteAudioPlayback() {
  const muted = isVoicePlaybackMuted();
  for (const peer of state.peers.values()) {
    for (const audio of peer.audioElements.values()) {
      audio.muted = muted;
      applyAudioOutputDevice(audio).catch(() => {});
    }
  }
}

async function syncAudioOutputDevices() {
  if (!supportsAudioOutputSelection()) return false;

  const mediaElements = [elements.screenVideo];
  for (const peer of state.peers.values()) {
    mediaElements.push(...peer.audioElements.values());
  }

  const results = await Promise.all(mediaElements.map((mediaElement) => applyAudioOutputDevice(mediaElement)));
  const contextSynced = await applyAudioOutputDeviceToContext();
  return results.every(Boolean) && contextSynced !== false;
}

async function applyAudioOutputDevice(mediaElement) {
  if (!supportsAudioOutputSelection()) return false;

  const sinkId = state.outputDeviceId || '';
  if (mediaElement.sinkId === sinkId) return true;

  try {
    await mediaElement.setSinkId(sinkId);
    return true;
  } catch (error) {
    console.warn('Audio output device unavailable', error);
    return false;
  }
}

async function applyAudioOutputDeviceToContext() {
  if (!state.audioContext || typeof state.audioContext.setSinkId !== 'function') return true;

  try {
    await state.audioContext.setSinkId(state.outputDeviceId || '');
    return true;
  } catch (error) {
    console.warn('Audio context output device unavailable', error);
    return false;
  }
}

function getSharedAudioContext() {
  state.audioContext ||= new AudioContext();
  applyAudioOutputDeviceToContext().catch(() => {});
  return state.audioContext;
}

function isVoicePlaybackMuted() {
  return state.outputMuted || isLocalAppAudioSuppressed();
}

function isAppPlaybackMuted() {
  return state.outputMuted || isLocalAppAudioSuppressed();
}

async function handleServerMessage(event) {
  const message = JSON.parse(event.data);

  if (message.type === 'hello') {
    setStatus('connected', '');
    syncPeers(message.peers.map((peer) => peer.id));
    for (const peer of message.peers) {
      createParticipant(peer);
    }
    refreshParticipantState();
    return;
  }

  if (message.type === 'ping') {
    setStatus('connected', '');
    return;
  }

  if (message.type === 'room-not-found') {
    showRoomNotFound();
    return;
  }

  if (message.type === 'peer-joined') {
    createParticipant(message.peer);
    playPeerCue('join');
    refreshParticipantState();
    return;
  }

  if (message.type === 'peer-left') {
    const hadPeer = state.peers.has(message.peerId);
    removePeer(message.peerId);
    if (hadPeer) playPeerCue('leave');
    refreshParticipantState();
    return;
  }

  if (message.type === 'peer-updated') {
    updateParticipant(message.peer);
    return;
  }

  if (message.type === 'room-full') {
    showToast(`Комната заполнена: максимум ${message.maxRoomPeers}`);
    leaveRoom();
    return;
  }

  if (message.type === 'signal') {
    await handleSignal(message.from, message.signalType, message.payload);
  }
}

function syncPeers(peerIds) {
  const livePeerIds = new Set(peerIds);
  for (const peerId of state.peers.keys()) {
    if (!livePeerIds.has(peerId)) {
      removePeer(peerId);
    }
  }
}

function createParticipant(peerInfo) {
  const isLocal = Boolean(peerInfo.isLocal || peerInfo.id === state.peerId);
  peerInfo.isLocal = isLocal;

  const existing = isLocal ? state.self : state.peers.get(peerInfo.id);
  if (existing) {
    if (isLocal) {
      const duplicate = state.peers.get(peerInfo.id);
      duplicate?.node.remove();
      state.peers.delete(peerInfo.id);
    }
    updateParticipant(peerInfo);
    return existing;
  }

  const fragment = elements.template.content.cloneNode(true);
  const node = fragment.querySelector('.participant');
  const avatar = fragment.querySelector('.avatar');
  const nameLabel = fragment.querySelector('.participant-name');
  const screenAction = fragment.querySelector('.participant-screen-action');
  const status = fragment.querySelector('p');

  node.dataset.peerId = peerInfo.id;
  if (isLocal) node.dataset.local = 'true';
  avatar.textContent = getInitials(peerInfo.name);
  nameLabel.textContent = isLocal ? `${peerInfo.name} · вы` : peerInfo.name;
  setParticipantStatus({ status }, isLocal ? '' : 'подключение');
  node.dataset.deafened = String(Boolean(peerInfo.deafened));
  node.dataset.muted = String(Boolean(peerInfo.muted));
  node.dataset.screen = String(Boolean(peerInfo.screen));
  applyParticipantPalette(node, peerInfo);

  elements.participants.append(node);

  const participant = {
    analyser: null,
    audioElements: new Map(),
    deafened: Boolean(peerInfo.deafened),
    id: peerInfo.id,
    incomingVoiceActive: false,
    incomingVoiceStats: createAudioActivityStats(),
    isLocal,
    localScreenSenders: [],
    lastReconnectAt: 0,
    livekitParticipant: null,
    connectionQuality: 'unknown',
    makingOffer: false,
    micSender: null,
    meterData: null,
    muted: Boolean(peerInfo.muted),
    name: peerInfo.name,
    needsRenegotiate: false,
    node,
    pendingCandidates: [],
    pingMs: null,
    pc: null,
    reconnecting: false,
    reconnectTimer: 0,
    micReceiver: null,
    screen: Boolean(peerInfo.screen),
    screenAction,
    screenAudio: Boolean(peerInfo.screenAudio),
    screenSubscribed: false,
    screenStream: null,
    screenStreamId: peerInfo.screenStreamId || '',
    status,
    stream: null
  };

  screenAction.addEventListener('click', () => enterScreenView(participant.id).catch((error) => console.error(error)));
  if (participant.isLocal) {
    state.self = participant;
    state.peers.delete(peerInfo.id);
  } else {
    state.peers.set(peerInfo.id, participant);
  }
  refreshScreenAction(participant);
  refreshParticipantState();
  return participant;
}

function updateParticipant(peerInfo) {
  const participant = peerInfo.id === state.peerId ? state.self : state.peers.get(peerInfo.id);
  if (!participant) return;

  const hadScreen = participant.screen;
  const hasScreenUpdate = Object.hasOwn(peerInfo, 'screen');
  if (Object.hasOwn(peerInfo, 'name')) participant.name = peerInfo.name || participant.name;
  if (Object.hasOwn(peerInfo, 'deafened')) participant.deafened = Boolean(peerInfo.deafened);
  if (Object.hasOwn(peerInfo, 'muted')) participant.muted = Boolean(peerInfo.muted);
  if (hasScreenUpdate) participant.screen = Boolean(peerInfo.screen);
  if (Object.hasOwn(peerInfo, 'screenAudio')) participant.screenAudio = Boolean(peerInfo.screenAudio);
  if (Object.hasOwn(peerInfo, 'screenStreamId')) participant.screenStreamId = peerInfo.screenStreamId || '';
  participant.node.dataset.deafened = String(participant.deafened);
  participant.node.dataset.muted = String(participant.muted);
  participant.node.dataset.screen = String(participant.screen);
  applyParticipantPalette(participant.node, participant);
  participant.node.querySelector('.avatar').textContent = getInitials(participant.name);
  participant.node.querySelector('.participant-name').textContent = participant.isLocal ? `${participant.name} · вы` : participant.name;
  if (Object.hasOwn(peerInfo, 'muted') && participant.muted) {
    resetAudioActivityStats(participant.incomingVoiceStats);
    participant.incomingVoiceActive = false;
    setParticipantSpeaking(participant, false);
  }
  if (hasScreenUpdate && !participant.isLocal && hadScreen !== participant.screen) {
    playStreamCue(participant.screen ? 'start' : 'stop');
  }
  if (!participant.screen && state.viewedScreenPeerId === participant.id) {
    closeScreenView();
  }
  if (!participant.screen && state.sharedScreenPeerId === participant.id) {
    detachRemoteScreen(participant);
  }
  updatePeerStatus(participant);
  refreshScreenAction(participant);
  refreshScreenStage();
}

function removePeer(peerId) {
  const peer = state.peers.get(peerId);
  if (!peer) return;

  peer.pc?.close();
  window.clearTimeout(peer.reconnectTimer);
  removeAudioElements(peer);
  if (state.viewedScreenPeerId === peer.id) {
    closeScreenView();
  }
  if (state.sharedScreenPeerId === peer.id) {
    hideScreenStage();
  }
  peer.node.remove();
  state.peers.delete(peerId);
  if (state.peers.size === 0) setParticipantSpeaking(state.self, false);
}

async function callPeer(peerId) {
  const peer = state.peers.get(peerId);
  if (!peer) return;

  await renegotiatePeer(peer);
}

function ensurePeerConnection(peer) {
  if (peer.pc) return peer.pc;

  const pc = new RTCPeerConnection(state.iceConfig);
  peer.pc = pc;
  peer.incomingVoiceActive = false;
  peer.micReceiver = null;
  resetAudioActivityStats(peer.incomingVoiceStats);
  setParticipantSpeaking(peer, false);

  for (const track of state.localStream.getTracks()) {
    const sender = pc.addTrack(track, state.localStream);
    if (track.kind === 'audio') {
      peer.micSender = sender;
      applyMicrophoneSenderProfile(sender).catch((error) => console.warn('Microphone sender profile unavailable', error));
    }
  }
  pc.addTransceiver('video', { direction: 'recvonly' });
  if (peer.screenSubscribed) addLocalScreenTracks(peer);

  pc.addEventListener('icecandidate', (event) => {
    if (event.candidate) {
      sendSignal(peer.id, 'candidate', event.candidate).catch(() => {});
    }
  });

  pc.addEventListener('track', (event) => {
    const [stream] = event.streams;
    attachRemoteTrack(peer, event.track, stream, event.receiver);
  });

  pc.addEventListener('connectionstatechange', () => handlePeerConnectionStateChange(peer));
  pc.addEventListener('signalingstatechange', () => {
    if (pc.signalingState === 'stable' && peer.needsRenegotiate) {
      peer.needsRenegotiate = false;
      renegotiatePeer(peer).catch((error) => console.error(error));
    }
  });
  pc.addEventListener('iceconnectionstatechange', () => handlePeerConnectionStateChange(peer));

  updatePeerStatus(peer);
  return pc;
}

function handlePeerConnectionStateChange(peer) {
  updatePeerStatus(peer);

  if (isPeerConnected(peer)) {
    window.clearTimeout(peer.reconnectTimer);
    peer.reconnectTimer = 0;
    peer.reconnecting = false;
    return;
  }

  if (isPeerDisconnected(peer)) {
    schedulePeerReconnect(peer);
  }
}

function schedulePeerReconnect(peer) {
  if (!state.joined || peer.isLocal || peer.reconnectTimer) return;

  const now = Date.now();
  if (now - peer.lastReconnectAt < PEER_RECONNECT_COOLDOWN_MS) return;

  peer.reconnectTimer = window.setTimeout(() => {
    peer.reconnectTimer = 0;
    reconnectPeer(peer, { manual: false }).catch((error) => console.error(error));
  }, PEER_RECONNECT_DELAY_MS);
}

async function reconnectPeer(peer, options = {}) {
  const { manual = false } = options;
  if (!state.joined || peer.isLocal || !state.peers.has(peer.id)) return;

  window.clearTimeout(peer.reconnectTimer);
  peer.reconnectTimer = 0;
  peer.lastReconnectAt = Date.now();
  peer.reconnecting = true;
  updatePeerStatus(peer);

  try {
    if (!peer.pc || peer.pc.connectionState === 'closed') {
      peer.pc = null;
      await callPeer(peer.id);
    } else {
      peer.pc.restartIce?.();
      await renegotiatePeer(peer);
    }

    if (manual) showToast('Переподключение запущено');
  } catch (error) {
    console.error(error);
    if (manual) showToast('Не удалось переподключиться');
  } finally {
    peer.reconnecting = false;
    updatePeerStatus(peer);
  }
}

function addLocalScreenTracks(peer) {
  if (!peer.pc || !state.localScreenStream || !peer.screenSubscribed) return;

  const existingTracks = new Set(peer.localScreenSenders.map((sender) => sender.track).filter(Boolean));
  for (const track of state.localScreenStream.getTracks()) {
    if (existingTracks.has(track)) continue;
    const sender = peer.pc.addTrack(track, state.localScreenStream);
    peer.localScreenSenders.push(sender);
    applyScreenSenderProfile(sender, track).catch((error) => console.warn('Screen sender profile unavailable', error));
  }
}

async function applyMicrophoneSenderProfile(sender) {
  await applyAudioSenderBitrate(sender, MICROPHONE_AUDIO_BITRATE);
}

async function applyAudioSenderBitrate(sender, bitrate) {
  if (!sender?.getParameters || !sender.setParameters) return;

  const parameters = sender.getParameters();
  if (!parameters.encodings?.length) return;

  const [encoding] = parameters.encodings;
  encoding.maxBitrate = bitrate;
  await sender.setParameters(parameters);
}

async function applyScreenSenderProfile(sender, track) {
  if (!sender?.getParameters || !sender.setParameters) return;

  const parameters = sender.getParameters();
  if (!parameters.encodings?.length) return;

  const [encoding] = parameters.encodings;
  if (track.kind === 'video') {
    const profile = getScreenProfile(state.localScreenProfileId);
    encoding.maxBitrate = profile.videoBitrate;
    encoding.maxFramerate = profile.frameRate;
    encoding.scaleResolutionDownBy = 1;
  } else if (track.kind === 'audio') {
    await applyAudioSenderBitrate(sender, SCREEN_AUDIO_BITRATE);
    return;
  } else {
    return;
  }

  await sender.setParameters(parameters);
}

function removeLocalScreenTracks(peer) {
  if (!peer.pc || peer.localScreenSenders.length === 0) return false;

  let removed = false;
  for (const sender of peer.localScreenSenders) {
    if (peer.pc.getSenders().includes(sender)) {
      peer.pc.removeTrack(sender);
      removed = true;
    }
  }
  peer.localScreenSenders = [];
  return removed;
}

async function handleSignal(from, signalType, payload) {
  const peer = state.peers.get(from) || createParticipant({ deafened: false, id: from, muted: false, name: 'Гость' });
  const pc = ensurePeerConnection(peer);

  if (signalType === 'screen-subscribe') {
    peer.screenSubscribed = Boolean(state.localScreenStream);
    if (peer.screenSubscribed) {
      addLocalScreenTracks(peer);
      await renegotiatePeer(peer);
    }
    return;
  }

  if (signalType === 'screen-unsubscribe') {
    peer.screenSubscribed = false;
    const removed = removeLocalScreenTracks(peer);
    if (removed) await renegotiatePeer(peer);
    return;
  }

  if (signalType === 'offer') {
    await pc.setRemoteDescription(payload);
    await flushCandidates(peer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await sendSignal(from, 'answer', pc.localDescription);
    return;
  }

  if (signalType === 'answer') {
    if (pc.signalingState !== 'stable') {
      await pc.setRemoteDescription(payload);
      await flushCandidates(peer);
    }
    return;
  }

  if (signalType === 'candidate') {
    if (pc.remoteDescription) {
      await pc.addIceCandidate(payload);
    } else {
      peer.pendingCandidates.push(payload);
    }
  }
}

async function renegotiatePeer(peer) {
  const pc = ensurePeerConnection(peer);
  if (pc.signalingState !== 'stable') {
    peer.needsRenegotiate = true;
    return;
  }

  peer.needsRenegotiate = false;
  peer.makingOffer = true;
  try {
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await pc.setLocalDescription(offer);
    await sendSignal(peer.id, 'offer', pc.localDescription);
  } finally {
    peer.makingOffer = false;
  }
}

async function flushCandidates(peer) {
  while (peer.pendingCandidates.length > 0) {
    const candidate = peer.pendingCandidates.shift();
    await peer.pc.addIceCandidate(candidate);
  }
}

function attachRemoteTrack(peer, track, stream, receiver = null) {
  const mediaStream = stream || new MediaStream([track]);
  const isScreenStream = isRemoteScreenTrack(peer, track, mediaStream);

  if (isScreenStream) {
    attachRemoteScreenStream(peer, mediaStream);
    return;
  }

  if (track.kind === 'audio') {
    peer.stream = mediaStream;
    peer.micReceiver = receiver;
    attachRemoteAudioTrack(peer, track);
    if (!peer.analyser) attachMeter(peer, new MediaStream([track]));
    track.addEventListener(
      'ended',
      () => {
        if (peer.micReceiver === receiver) peer.micReceiver = null;
        resetAudioActivityStats(peer.incomingVoiceStats);
        peer.incomingVoiceActive = false;
        setParticipantSpeaking(peer, false);
      },
      { once: true }
    );
    updatePeerStatus(peer);
  }
}

function isRemoteScreenTrack(peer, track, stream) {
  if (track.kind === 'video') return true;
  if (peer.screenStreamId && stream.id === peer.screenStreamId) return true;
  if (track.kind !== 'audio' || !peer.screen || !peer.screenAudio) return false;

  const alreadyHasMicAudio = Boolean(peer.stream?.getAudioTracks().some((audioTrack) => audioTrack.readyState !== 'ended'));
  const alreadyWatchingScreen = state.viewedScreenPeerId === peer.id || Boolean(peer.screenStream);
  return alreadyHasMicAudio && alreadyWatchingScreen;
}

function attachRemoteScreenStream(peer, stream) {
  const screenStream = mergeRemoteScreenStream(peer, stream);
  peer.screen = true;
  peer.screenStream = screenStream;
  peer.screenAudio = peer.screenAudio || screenStream.getAudioTracks().some((track) => track.readyState !== 'ended');
  peer.screenStreamId ||= screenStream.id;
  peer.node.dataset.screen = 'true';

  for (const track of screenStream.getVideoTracks()) {
    if (watchedRemoteScreenTracks.has(track)) continue;
    watchedRemoteScreenTracks.add(track);
    track.addEventListener('ended', () => detachRemoteScreen(peer), { once: true });
  }
  for (const track of screenStream.getAudioTracks()) {
    if (watchedRemoteScreenTracks.has(track)) continue;
    watchedRemoteScreenTracks.add(track);
    track.addEventListener(
      'ended',
      () => {
        peer.screenAudio = false;
        refreshScreenStage();
      },
      { once: true }
    );
  }

  if (state.viewedScreenPeerId !== peer.id) {
    syncLiveKitScreenSubscriptions(peer);
    detachRemoteScreen(peer);
    return;
  }

  state.screenRequesting = false;
  refreshAllScreenActions();
  refreshScreenStage();
  updatePeerStatus(peer);
}

function mergeRemoteScreenStream(peer, stream) {
  if (!peer.screenStream || peer.screenStream === stream) return stream;

  const existingTrackIds = new Set(peer.screenStream.getTracks().map((track) => track.id));
  for (const track of stream.getTracks()) {
    if (!existingTrackIds.has(track.id)) peer.screenStream.addTrack(track);
  }

  return peer.screenStream;
}

function detachRemoteScreen(peer) {
  peer.screenStream = null;
  peer.node.dataset.screen = String(peer.screen);
  if (state.sharedScreenPeerId === peer.id) hideScreenStage();
  refreshScreenStage();
  updatePeerStatus(peer);
  refreshScreenAction(peer);
}

function attachRemoteAudioTrack(peer, track) {
  if (peer.audioElements.has(track.id)) return;

  const audio = document.createElement('audio');
  audio.autoplay = true;
  audio.muted = isVoicePlaybackMuted();
  audio.playsInline = true;
  audio.srcObject = new MediaStream([track]);
  peer.audioElements.set(track.id, audio);
  document.body.append(audio);
  applyAudioOutputDevice(audio).catch(() => {});
  playMediaElement(audio);

  track.addEventListener(
    'ended',
    () => {
      audio.remove();
      peer.audioElements.delete(track.id);
    },
    { once: true }
  );
}

function detachRemoteAudioTrack(peer, trackId) {
  const audio = peer.audioElements.get(trackId);
  if (!audio) return;

  audio.pause();
  audio.srcObject = null;
  audio.remove();
  peer.audioElements.delete(trackId);
}

function removeAudioElements(peer) {
  for (const audio of peer.audioElements.values()) {
    audio.remove();
  }
  peer.audioElements.clear();
}

function attachMeter(participant, stream) {
  if (!participant || !stream) return;
  try {
    const context = getSharedAudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    participant.analyser = analyser;
    participant.meterData = new Uint8Array(analyser.frequencyBinCount);
  } catch (error) {
    console.warn('Audio meter unavailable', error);
  }
}

function startMeters() {
  if (meterFrame) return;

  const tick = () => {
    updateMeter(state.self);
    for (const peer of state.peers.values()) updateMeter(peer);
    meterFrame = requestAnimationFrame(tick);
  };
  meterFrame = requestAnimationFrame(tick);
}

function stopMeters() {
  if (meterFrame) cancelAnimationFrame(meterFrame);
  meterFrame = 0;
}

function startPeerLatencyStats() {
  if (peerLatencyTimer) return;

  updatePeerLatencyStats().catch((error) => console.warn('Peer latency unavailable', error));
  peerLatencyTimer = window.setInterval(() => {
    updatePeerLatencyStats().catch((error) => console.warn('Peer latency unavailable', error));
  }, PEER_LATENCY_INTERVAL_MS);
}

function stopPeerLatencyStats() {
  if (peerLatencyTimer) window.clearInterval(peerLatencyTimer);
  peerLatencyTimer = 0;
}

function startSpeakingStats() {
  if (speakingStatsTimer) return;

  const tick = () => {
    updateSpeakingStats().catch((error) => console.warn('Speaking stats unavailable', error));
  };
  speakingStatsTimer = window.setInterval(tick, SPEAKING_STATS_INTERVAL_MS);
  tick();
}

function stopSpeakingStats() {
  if (speakingStatsTimer) window.clearInterval(speakingStatsTimer);
  speakingStatsTimer = 0;
  setParticipantSpeaking(state.self, false);
  for (const peer of state.peers.values()) {
    resetAudioActivityStats(peer.incomingVoiceStats);
    peer.incomingVoiceActive = false;
    setParticipantSpeaking(peer, false);
  }
}

async function updateSpeakingStats() {
  if (!state.joined) return;

  const peers = [...state.peers.values()];
  await Promise.allSettled(peers.map((peer) => updatePeerVoiceActivity(peer)));

  for (const peer of peers) {
    setParticipantSpeaking(peer, !peer.muted && peer.incomingVoiceActive);
  }
}

async function updatePeerVoiceActivity(peer) {
  try {
    peer.incomingVoiceActive = await readIncomingVoiceActivity(peer);
  } catch (error) {
    resetAudioActivityStats(peer.incomingVoiceStats);
    peer.incomingVoiceActive = false;
    throw error;
  }
}

async function readIncomingVoiceActivity(peer) {
  if (peer.livekitParticipant) {
    return Boolean(peer.livekitParticipant.isSpeaking);
  }

  const receiver = peer.micReceiver || findVoiceReceiver(peer);
  const track = receiver?.track;
  if (peer.muted || !isPeerConnectionStatsUsable(peer) || !isLiveEnabledTrack(track)) {
    resetAudioActivityStats(peer.incomingVoiceStats);
    return false;
  }

  peer.micReceiver = receiver;
  return readAudioActivityStats(receiver, peer.incomingVoiceStats);
}

function findVoiceReceiver(peer) {
  if (!peer.pc || !peer.stream) return null;

  const voiceTracks = new Set(peer.stream.getAudioTracks().filter((track) => track.readyState !== 'ended'));
  return peer.pc.getReceivers().find((receiver) => voiceTracks.has(receiver.track)) || null;
}

function isPeerConnectionStatsUsable(peer) {
  if (!peer?.pc) return false;

  return peer.pc.connectionState === 'connected'
    || peer.pc.iceConnectionState === 'connected'
    || peer.pc.iceConnectionState === 'completed';
}

function isLiveEnabledTrack(track) {
  return Boolean(track && track.kind === 'audio' && track.readyState !== 'ended' && track.enabled);
}

async function readAudioActivityStats(source, activityStats) {
  if (!source?.getStats) {
    resetAudioActivityStats(activityStats);
    return false;
  }

  const stats = await source.getStats();
  return getAudioActivityFromStats(stats, activityStats);
}

function createAudioActivityStats() {
  return {
    activeUntil: 0,
    reports: new Map()
  };
}

function resetAudioActivityStats(activityStats) {
  if (!activityStats) return;
  activityStats.activeUntil = 0;
  activityStats.reports.clear();
}

function getAudioActivityFromStats(stats, activityStats) {
  const now = performance.now();
  let activeNow = false;
  let sawAudioReport = false;
  const currentReports = new Set();

  stats.forEach((report) => {
    if (!isAudioActivityReport(report)) return;
    sawAudioReport = true;

    if (typeof report.audioLevel === 'number' && report.audioLevel > REMOTE_SPEAKING_AUDIO_LEVEL_FLOOR) {
      activeNow = true;
    }

    if (typeof report.totalAudioEnergy !== 'number' || typeof report.totalSamplesDuration !== 'number') {
      return;
    }

    const reportId = report.id || `${report.type}:${currentReports.size}`;
    currentReports.add(reportId);
    const previous = activityStats.reports.get(reportId);
    if (
      previous
      && report.totalAudioEnergy >= previous.energy
      && report.totalSamplesDuration > previous.duration
    ) {
      const energyDelta = report.totalAudioEnergy - previous.energy;
      const durationDelta = report.totalSamplesDuration - previous.duration;
      if (energyDelta > 0 && energyDelta / durationDelta > REMOTE_SPEAKING_SIGNAL_POWER_FLOOR) {
        activeNow = true;
      }
    }

    activityStats.reports.set(reportId, {
      duration: report.totalSamplesDuration,
      energy: report.totalAudioEnergy
    });
  });

  for (const reportId of activityStats.reports.keys()) {
    if (!currentReports.has(reportId)) activityStats.reports.delete(reportId);
  }

  if (!sawAudioReport) {
    resetAudioActivityStats(activityStats);
    return false;
  }

  if (activeNow) activityStats.activeUntil = now + SPEAKING_SIGNAL_HOLD_MS;
  return activityStats.activeUntil > now;
}

function isAudioActivityReport(report) {
  return report.kind === 'audio'
    || report.mediaType === 'audio'
    || typeof report.audioLevel === 'number'
    || typeof report.totalAudioEnergy === 'number';
}

function setParticipantSpeaking(participant, speaking) {
  if (!participant?.node) return;
  participant.node.dataset.speaking = String(Boolean(speaking));
}

async function updatePeerLatencyStats() {
  if (!state.joined) return;

  if (state.livekitRoom) {
    await updateLocalLiveKitLatency();
    return;
  }

  await Promise.allSettled([...state.peers.values()].map((peer) => updatePeerLatency(peer)));
}

async function updateLocalLiveKitLatency() {
  try {
    const publication = state.localMicPublication || findFirstLocalPublication();
    const stats = await publication?.track?.getRTCStatsReport?.();
    const rttMs = getRoundTripTimeFromStats(stats);
    if (rttMs !== null) {
      state.localPingMs = Math.max(0, Math.round(rttMs));
    }
  } catch (error) {
    console.warn('LiveKit latency unavailable', error);
  }

  refreshLocalNetworkIndicator();
}

function findFirstLocalPublication() {
  return state.livekitRoom?.localParticipant?.trackPublications?.values?.().next?.().value || null;
}

function getRoundTripTimeFromStats(stats) {
  if (!stats?.forEach) return null;

  let candidatePairRttMs = null;
  let remoteInboundRttMs = null;
  stats.forEach((report) => {
    if (
      report.type === 'candidate-pair'
      && report.state === 'succeeded'
      && (report.nominated || report.selected)
      && typeof report.currentRoundTripTime === 'number'
    ) {
      candidatePairRttMs = report.currentRoundTripTime * 1000;
      return;
    }

    if (
      remoteInboundRttMs === null
      && report.type === 'remote-inbound-rtp'
      && typeof report.roundTripTime === 'number'
    ) {
      remoteInboundRttMs = report.roundTripTime * 1000;
    }
  });

  return candidatePairRttMs ?? remoteInboundRttMs;
}

async function updatePeerLatency(peer) {
  if (peer.isLocal || !peer.pc || peer.pc.connectionState === 'closed') return;

  const stats = await peer.pc.getStats();
  let rttMs = null;

  stats.forEach((report) => {
    if (
      report.type === 'candidate-pair'
      && report.state === 'succeeded'
      && (report.nominated || report.selected)
      && typeof report.currentRoundTripTime === 'number'
    ) {
      rttMs = report.currentRoundTripTime * 1000;
      return;
    }

    if (
      rttMs === null
      && report.type === 'remote-inbound-rtp'
      && report.kind === 'audio'
      && typeof report.roundTripTime === 'number'
    ) {
      rttMs = report.roundTripTime * 1000;
    }
  });

  if (rttMs === null) return;

  peer.pingMs = Math.max(0, Math.round(rttMs));
}

function updateMeter(participant) {
  if (!participant?.analyser || !participant.meterData) return;

  participant.analyser.getByteTimeDomainData(participant.meterData);
  let sum = 0;
  for (const value of participant.meterData) {
    const centered = value - 128;
    sum += centered * centered;
  }

  const rms = Math.sqrt(sum / participant.meterData.length);
  const level = Math.min(1, rms / 48);
  const levelDb = amplitudeToDb(Math.min(1, rms / 128));
  const visibleLevel = participant.muted ? 0 : level;
  const visibleLevelDb = participant.muted ? GATE_THRESHOLD_MIN_DB : levelDb;
  participant.node.style.setProperty('--level', visibleLevel.toFixed(3));
  if (participant.isLocal) {
    refreshMicrophoneLevelMeter(visibleLevelDb);
    setParticipantSpeaking(participant, isLocalMicrophoneSpeaking(participant, levelDb, rms));
  }
}

function isLocalMicrophoneSpeaking(participant, levelDb, rms) {
  if (participant.muted) return false;
  if (!isGateDisabled()) return levelDb >= state.gateThresholdDb;

  return rms > LOCAL_GATE_DISABLED_RMS_FLOOR;
}

function getCueGain(value) {
  return value * NOTIFICATION_VOLUME_BOOST;
}

function playPeerCue(type) {
  if (isAppPlaybackMuted()) return;

  try {
    const context = getSharedAudioContext();
    if (context.state !== 'running') {
      elements.soundButton.hidden = false;
      return;
    }

    const isJoin = type === 'join';
    const now = context.currentTime;
    const notes = isJoin ? [520, 760] : [390, 240];

    notes.forEach((frequency, index) => {
      const startedAt = now + index * 0.13;
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, startedAt);

      gain.gain.setValueAtTime(0.0001, startedAt);
      gain.gain.exponentialRampToValueAtTime(getCueGain(isJoin ? 0.052 : 0.044), startedAt + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + 0.11);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startedAt);
      oscillator.stop(startedAt + 0.13);
      oscillator.addEventListener('ended', () => {
        oscillator.disconnect();
        gain.disconnect();
      });
    });
  } catch (error) {
    console.warn('Peer sound unavailable', error);
  }
}

function playMicCue(muted) {
  if (isAppPlaybackMuted()) return;

  try {
    const context = getSharedAudioContext();
    if (context.state !== 'running') {
      elements.soundButton.hidden = false;
      return;
    }

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(muted ? 460 : 260, now);
    oscillator.frequency.exponentialRampToValueAtTime(muted ? 190 : 620, now + 0.2);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(getCueGain(0.038), now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.26);
    oscillator.addEventListener('ended', () => {
      oscillator.disconnect();
      gain.disconnect();
    });
  } catch (error) {
    console.warn('Mic sound unavailable', error);
  }
}

function playOutputCue(muted) {
  if (isLocalAppAudioSuppressed()) return;

  try {
    const context = getSharedAudioContext();
    if (context.state !== 'running') {
      elements.soundButton.hidden = false;
      return;
    }

    const now = context.currentTime;
    const frequencies = muted ? [660, 360] : [360, 660];

    frequencies.forEach((frequency, index) => {
      const startedAt = now + index * 0.085;
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, startedAt);

      gain.gain.setValueAtTime(0.0001, startedAt);
      gain.gain.exponentialRampToValueAtTime(getCueGain(0.034), startedAt + 0.014);
      gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + 0.11);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startedAt);
      oscillator.stop(startedAt + 0.12);
      oscillator.addEventListener('ended', () => {
        oscillator.disconnect();
        gain.disconnect();
      });
    });
  } catch (error) {
    console.warn('Output sound unavailable', error);
  }
}

function playStreamCue(type) {
  if (isAppPlaybackMuted()) return;

  try {
    const context = getSharedAudioContext();
    if (context.state !== 'running') {
      elements.soundButton.hidden = false;
      return;
    }

    const isStart = type === 'start';
    const now = context.currentTime;
    const notes = isStart ? [880, 1175, 1568] : [1568, 1109, 740];

    notes.forEach((frequency, index) => {
      const startedAt = now + index * 0.105;
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, startedAt);

      gain.gain.setValueAtTime(0.0001, startedAt);
      gain.gain.exponentialRampToValueAtTime(getCueGain(0.038), startedAt + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + 0.09);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startedAt);
      oscillator.stop(startedAt + 0.105);
      oscillator.addEventListener('ended', () => {
        oscillator.disconnect();
        gain.disconnect();
      });
    });
  } catch (error) {
    console.warn('Stream sound unavailable', error);
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function sendSignal(to, signalType, payload) {
  return postJson('/signal', {
    from: state.peerId,
    payload,
    roomId: state.roomId,
    sessionToken: state.sessionToken,
    signalType,
    to
  });
}

async function postState() {
  if (!state.joined) return;
  await postJson('/state', {
    deafened: state.outputMuted,
    muted: state.muted,
    name: getDisplayName(),
    peerId: state.peerId,
    roomId: state.roomId,
    screen: Boolean(state.localScreenStream),
    screenAudio: hasScreenAudio(),
    screenStreamId: state.localScreenStream?.id || '',
    sessionToken: state.sessionToken
  });
}

function applyIceConfig(iceConfig) {
  if (!iceConfig || !Array.isArray(iceConfig.iceServers)) return;
  state.iceConfig = iceConfig;
  scheduleIceConfigRefresh(iceConfig.turnTtlSeconds);
}

function scheduleIceConfigRefresh(ttlSeconds) {
  window.clearTimeout(state.iceRefreshTimer);
  if (!state.joined) return;

  const ttlMs = Number(ttlSeconds) * 1000;
  const delay = Number.isFinite(ttlMs) && ttlMs > 0 ? Math.max(60_000, Math.floor(ttlMs * 0.7)) : 600_000;
  state.iceRefreshTimer = window.setTimeout(() => {
    refreshIceConfig().catch((error) => console.warn('ICE config refresh failed', error));
  }, delay);
}

async function refreshIceConfig() {
  if (!state.joined || !state.roomId) return;

  const query = new URLSearchParams({
    peer: state.peerId,
    room: state.roomId,
    token: state.sessionToken
  });
  applyIceConfig(await fetchJson(`/config?${query}`));
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Сервер недоступен');
  return response.json();
}

async function checkRoomExists(roomId) {
  const response = await fetch(`/rooms/${encodeURIComponent(roomId)}`, {
    headers: { Accept: 'application/json' }
  });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error('Не удалось проверить комнату');

  const payload = await response.json();
  return Boolean(payload.exists);
}

async function postJson(url, body) {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    method: 'POST'
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON errors are handled by the generic message below.
  }
  if (!response.ok) {
    throw new Error(payload?.error || 'Сервер недоступен');
  }
  return payload;
}

function setMicrophoneMuted(muted, options = {}) {
  const {
    playCue = true,
    post = true
  } = options;
  if (!state.localStream) return;
  const nextMuted = Boolean(muted);
  if (state.muted === nextMuted) return;

  state.muted = nextMuted;
  setMicrophoneCaptureEnabled(getLocalMicrophoneCapture(), !state.muted);
  syncLocalMicrophonePublicationMuted().catch((error) => console.warn('LiveKit microphone mute failed', error));

  if (playCue) playMicCue(state.muted);
  elements.muteButton.setAttribute('aria-pressed', String(state.muted));
  refreshCallControls();
  updateParticipant({
    deafened: state.outputMuted,
    id: state.peerId,
    muted: state.muted,
    name: getDisplayName()
  });
  if (post) postState().catch(() => {});
}

function toggleMute() {
  if (state.outputMuted && state.muted) {
    showToast('Сначала включите звук');
    return;
  }

  setMicrophoneMuted(!state.muted);
}

async function handleMicButtonClick(event) {
  if (!state.joined) {
    await joinRoom(event);
    return;
  }

  toggleMute();
}

async function handleLeaveButtonClick() {
  if (state.joined || state.localStream || state.connecting) {
    playPeerCue('leave');
    await wait(180);
    leaveRoom();
  }

  window.location.href = '/';
}

function toggleDevicePopover(event) {
  event.stopPropagation();
  closeOutputPopover();
  closeScreenProfilePopover();
  const willOpen = elements.devicePopover.hidden;
  elements.devicePopover.hidden = !willOpen;
  elements.deviceMenuButton.setAttribute('aria-expanded', String(willOpen));
  if (willOpen) refreshDevices().catch(() => {});
}

function closeDevicePopover() {
  elements.devicePopover.hidden = true;
  elements.deviceMenuButton.setAttribute('aria-expanded', 'false');
}

function closeDevicePopoverOnOutside(event) {
  if (elements.devicePopover.hidden) return;
  if (elements.devicePopover.contains(event.target) || elements.deviceMenuButton.contains(event.target)) return;
  closeDevicePopover();
}

function closeDevicePopoverOnEscape(event) {
  if (event.key === 'Escape') closeDevicePopover();
}

function toggleOutputPopover(event) {
  event.stopPropagation();
  closeDevicePopover();
  closeScreenProfilePopover();
  const willOpen = elements.outputPopover.hidden;
  elements.outputPopover.hidden = !willOpen;
  elements.outputMenuButton.setAttribute('aria-expanded', String(willOpen));
  if (willOpen) refreshDevices().catch(() => {});
}

function closeOutputPopover() {
  elements.outputPopover.hidden = true;
  elements.outputMenuButton.setAttribute('aria-expanded', 'false');
}

function closeOutputPopoverOnOutside(event) {
  if (elements.outputPopover.hidden) return;
  if (elements.outputPopover.contains(event.target) || elements.outputMenuButton.contains(event.target)) return;
  closeOutputPopover();
}

function closeOutputPopoverOnEscape(event) {
  if (event.key === 'Escape') closeOutputPopover();
}

function toggleScreenProfilePopover() {
  if (!state.joined || state.connecting) {
    showToast('Сначала подключитесь к комнате');
    return;
  }
  closeDevicePopover();
  closeOutputPopover();
  const willOpen = elements.screenProfilePopover.hidden;
  elements.screenProfilePopover.hidden = !willOpen;
  elements.screenButton.setAttribute('aria-expanded', String(willOpen));
}

function closeScreenProfilePopover() {
  elements.screenProfilePopover.hidden = true;
  elements.screenButton.setAttribute('aria-expanded', 'false');
}

function closeScreenProfileOnOutside(event) {
  if (elements.screenProfilePopover.hidden) return;
  if (elements.screenProfilePopover.contains(event.target) || elements.screenButton.contains(event.target)) return;
  closeScreenProfilePopover();
}

function closeScreenProfileOnEscape(event) {
  if (event.key === 'Escape') closeScreenProfilePopover();
}

function refreshCallControls() {
  const label = !state.joined
    ? state.connecting
      ? 'Подключение'
      : 'Подключить микрофон'
    : state.muted
      ? 'Включить микрофон'
      : 'Выключить микрофон';

  elements.muteText.textContent = label;
  elements.muteButton.setAttribute('aria-label', label);
  elements.muteButton.setAttribute('aria-pressed', String(state.joined && state.muted));
  elements.muteButton.dataset.state = state.connecting ? 'connecting' : !state.joined ? 'idle' : state.muted ? 'muted' : 'live';
}

function refreshScreenControls() {
  const sharing = Boolean(state.localScreenStream);
  const label = sharing ? 'Остановить демонстрацию' : 'Показать экран';

  elements.screenText.textContent = label;
  elements.screenButton.disabled = !state.joined || state.connecting;
  elements.screenButton.setAttribute('aria-label', label);
  elements.screenButton.setAttribute('aria-pressed', String(sharing));
  elements.screenButton.dataset.state = sharing ? 'live' : 'idle';
  if (sharing || !state.joined || state.connecting) closeScreenProfilePopover();
}

async function enterScreenView(peerId) {
  const peer = state.peers.get(peerId);
  if (!peer?.screen) {
    showToast('Демонстрация уже завершена');
    refreshAllScreenActions();
    return;
  }

  if (state.viewedScreenPeerId === peerId) return;
  if (state.viewedScreenPeerId) {
    await leaveScreenView({ quiet: true });
  }

  state.viewedScreenPeerId = peerId;
  state.screenRequesting = true;
  refreshAllScreenActions();
  refreshScreenStage();

  syncLiveKitScreenSubscriptions(peer);
  if (peer.screenStream) {
    state.screenRequesting = false;
    refreshScreenStage();
  }
}

async function leaveScreenView(options = {}) {
  const { quiet = false } = options;
  const peerId = closeScreenView();
  if (!peerId || !state.peers.has(peerId)) return;

  const peer = state.peers.get(peerId);
  syncLiveKitScreenSubscriptions(peer);
  if (!quiet) refreshAllScreenActions();
}

function closeScreenView() {
  const peerId = state.viewedScreenPeerId;
  state.viewedScreenPeerId = '';
  state.screenRequesting = false;

  const peer = peerId && state.peers.get(peerId);
  if (peer?.screenStream) {
    detachRemoteScreen(peer);
  } else {
    hideScreenStage();
  }
  refreshAllScreenActions();
  return peerId;
}

function refreshScreenAction(participant) {
  if (!participant?.screenAction) return;

  const viewing = state.viewedScreenPeerId === participant.id;
  const canWatch = !participant.isLocal && participant.screen && !viewing;
  participant.screenAction.hidden = !canWatch;
  participant.screenAction.disabled = state.screenRequesting;
  participant.screenAction.querySelector('span').textContent = state.screenRequesting ? 'Подключение' : 'Смотреть экран';
}

function refreshAllScreenActions() {
  if (state.self) refreshScreenAction(state.self);
  for (const peer of state.peers.values()) refreshScreenAction(peer);
}

function refreshScreenStage() {
  const peer = state.viewedScreenPeerId && state.peers.get(state.viewedScreenPeerId);
  if (!peer?.screen) {
    if (state.viewedScreenPeerId) closeScreenView();
    else hideScreenStage();
    return;
  }

  showScreenStage({
    peerId: peer.id,
    stream: peer.screenStream
  });
}

function showScreenStage({ peerId, stream }) {
  state.sharedScreenPeerId = stream ? peerId : '';
  document.body.dataset.screenView = 'true';
  elements.screenStage.hidden = false;
  elements.screenViewControls.hidden = !stream;
  elements.leaveButton.hidden = true;
  elements.screenExitButton.hidden = false;
  elements.screenPlaceholder.hidden = Boolean(stream);

  if (stream && elements.screenVideo.srcObject !== stream) {
    elements.screenVideo.srcObject = stream;
  }
  if (stream) {
    syncScreenVideoAudio();
    playMediaElement(elements.screenVideo);
  } else {
    elements.screenVideo.pause();
    elements.screenVideo.srcObject = null;
  }
}

function hideScreenStage() {
  state.sharedScreenPeerId = '';
  delete document.body.dataset.screenView;
  elements.screenStage.hidden = true;
  elements.screenViewControls.hidden = true;
  elements.screenPlaceholder.hidden = false;
  elements.screenExitButton.hidden = true;
  elements.leaveButton.hidden = false;
  elements.screenVideo.pause();
  elements.screenVideo.srcObject = null;
  if (document.fullscreenElement === elements.screenStage) {
    document.exitFullscreen().catch(() => {});
  }
  if (document.body.dataset.desktopScreenFullscreen === 'true') {
    setDesktopScreenFullscreen(false).catch((error) => console.error(error));
  }
}

function syncScreenVideoAudio() {
  const muted = state.screenMuted || state.screenVolume <= 0 || isAppPlaybackMuted();
  elements.screenVideo.volume = state.screenVolume;
  elements.screenVideo.muted = muted;
  applyAudioOutputDevice(elements.screenVideo).catch(() => {});
  elements.streamVolumeSlider.value = String(Math.round(state.screenVolume * 100));
  elements.streamVolumeButton.dataset.muted = String(muted);
  elements.streamVolumeButton.setAttribute('aria-pressed', String(muted));
  elements.streamVolumeButton.setAttribute('aria-label', muted ? 'Включить звук стрима' : 'Выключить звук стрима');
}

function isLocalAppAudioSuppressed() {
  return state.localAppAudioSuppressed;
}

function setLocalAppAudioSuppressed(suppressed) {
  state.localAppAudioSuppressed = Boolean(suppressed);
  syncLocalAppAudioSuppression();
}

function syncLocalAppAudioSuppression() {
  syncPlaybackMuteState();
}

function toggleScreenMute() {
  if (state.screenMuted || state.screenVolume <= 0) {
    state.screenMuted = false;
    if (state.screenVolume <= 0) state.screenVolume = 1;
  } else {
    state.screenMuted = true;
  }
  syncScreenVideoAudio();
}

function updateScreenVolumeFromSlider() {
  const nextVolume = Number(elements.streamVolumeSlider.value) / 100;
  state.screenVolume = Number.isFinite(nextVolume) ? Math.min(1, Math.max(0, nextVolume)) : 1;
  state.screenMuted = state.screenVolume <= 0;
  syncScreenVideoAudio();
}

async function toggleScreenFullscreen() {
  try {
    if (document.fullscreenElement === elements.screenStage) {
      await document.exitFullscreen();
      return;
    }

    if (document.body.dataset.desktopScreenFullscreen === 'true') {
      await setDesktopScreenFullscreen(false);
      return;
    }

    if (document.fullscreenEnabled) {
      try {
        await elements.screenStage.requestFullscreen();
        return;
      } catch (error) {
        if (!hasDesktopWindowControls()) throw error;
        console.warn('Stage fullscreen unavailable, using desktop window fullscreen', error);
      }
    }

    if (hasDesktopWindowControls()) {
      await setDesktopScreenFullscreen(true);
    } else {
      showToast('Полноэкранный режим недоступен');
    }
  } catch (error) {
    console.error(error);
    showToast('Не удалось переключить полноэкранный режим');
  }
}

function hasDesktopWindowControls() {
  return Boolean(window.voiceRoomWindow?.setFullscreen);
}

async function setDesktopScreenFullscreen(fullscreen) {
  const active = await window.voiceRoomWindow.setFullscreen(fullscreen);
  if (active) {
    document.body.dataset.desktopScreenFullscreen = 'true';
  } else {
    delete document.body.dataset.desktopScreenFullscreen;
  }
  setScreenFullscreenState(active || document.fullscreenElement === elements.screenStage);
}

function updateScreenFullscreenState() {
  const fullscreen = document.fullscreenElement === elements.screenStage;
  if (!fullscreen && document.body.dataset.desktopScreenFullscreen !== 'true') {
    setScreenFullscreenState(false);
    return;
  }

  setScreenFullscreenState(fullscreen || document.body.dataset.desktopScreenFullscreen === 'true');
}

function setScreenFullscreenState(fullscreen) {
  state.screenFullscreen = fullscreen;
  elements.screenFullscreenButton.dataset.fullscreen = String(fullscreen);
  elements.screenFullscreenButton.setAttribute('aria-pressed', String(fullscreen));
  elements.screenFullscreenButton.setAttribute(
    'aria-label',
    fullscreen ? 'Выйти из полноэкранного режима' : 'Открыть стрим на весь экран'
  );
}

function leaveRoom() {
  if (!state.joined && !state.localStream && !state.localScreenStream && !state.connecting) return;

  state.connecting = false;
  state.joined = false;
  state.localConnectionQuality = 'unknown';
  state.localPingMs = null;
  refreshLocalNetworkIndicator();
  window.clearTimeout(gateSwitchTimer);
  gateSwitchTimer = 0;
  window.clearTimeout(state.iceRefreshTimer);
  state.iceRefreshTimer = 0;
  state.eventSource?.close();
  state.eventSource = null;
  disconnectLiveKitRoom().catch((error) => console.warn('LiveKit disconnect failed', error));
  if (state.screenSourceRequest) cancelScreenSourcePicker();
  closeScreenView();

  for (const peer of state.peers.values()) {
    window.clearTimeout(peer.reconnectTimer);
    peer.pc?.close();
    removeAudioElements(peer);
    peer.node.remove();
  }
  state.peers.clear();

  state.self?.node.remove();
  state.self = null;
  stopLocalStream();
  stopLocalScreenStream();
  stopMeters();
  stopPeerLatencyStats();
  stopSpeakingStats();

  state.muted = false;
  refreshCallControls();
  refreshScreenControls();
  closeDevicePopover();
  closeOutputPopover();
  closeScreenProfilePopover();
  setStatus('idle', 'готово');
  refreshParticipantState();
}

function stopLocalStream() {
  stopMicrophoneCapture(getLocalMicrophoneCapture());
  state.localStream = null;
  state.localRawStream = null;
  state.micProcessor = null;
  refreshMicrophoneLevelMeter(GATE_THRESHOLD_MIN_DB);
}

function stopStream(stream) {
  for (const track of stream.getTracks()) track.stop();
}

function stopLocalScreenStream() {
  if (!state.localScreenStream) return;
  stopStream(state.localScreenStream);
  state.localScreenStream = null;
  state.screenStopping = false;
  setLocalAppAudioSuppressed(false);
  hideScreenStage();
}

function hasScreenAudio() {
  return Boolean(state.localScreenStream?.getAudioTracks().some((track) => track.readyState !== 'ended'));
}

function playMediaElement(element) {
  element.play().catch(() => {
    if (!element.muted) elements.soundButton.hidden = false;
  });
}

function updatePeerStatus(peer) {
  if (!peer.isLocal && isPeerDisconnected(peer)) {
    setParticipantStatus(peer, peer.reconnecting ? 'переподключение' : 'соединение потеряно');
    return;
  }

  if (!peer.isLocal && peer.reconnecting) {
    setParticipantStatus(peer, 'переподключение');
    return;
  }

  if (peer.screen) {
    setParticipantStatus(peer, peer.isLocal ? 'экран в эфире' : 'показывает экран');
    return;
  }

  if (peer.muted) {
    setParticipantStatus(peer, '');
    return;
  }

  if (peer.livekitParticipant) {
    setParticipantStatus(peer, '');
    return;
  }

  const stateText = peer.pc?.connectionState || peer.pc?.iceConnectionState;
  if (peer.isLocal || stateText === 'connected' || stateText === 'completed') {
    setParticipantStatus(peer, '');
    return;
  }

  setParticipantStatus(peer, 'подключение');
}

function refreshLocalNetworkIndicator() {
  if (!elements.localNetwork || !elements.localNetworkValue) return;

  const disconnected = state.joined && state.localConnectionQuality === 'lost';
  const quality = disconnected ? 'lost' : getPeerLatencyQuality(state.localPingMs, state.localConnectionQuality);
  elements.localNetwork.dataset.quality = state.joined ? quality : 'unknown';
  elements.localNetworkValue.textContent = state.joined
    ? state.localPingMs === null
      ? getPeerConnectionQualityLabel(state.localConnectionQuality)
      : `${state.localPingMs} мс`
    : '--';
  elements.localNetwork.title = !state.joined
    ? 'Пинг до LiveKit появится после подключения'
    : state.localPingMs === null
      ? 'Качество соединения до LiveKit'
      : `Пинг до LiveKit ${state.localPingMs} мс`;
}

function getPeerLatencyQuality(pingMs, connectionQuality = 'unknown') {
  if (pingMs !== null && Number.isFinite(pingMs)) {
    if (pingMs <= PEER_LATENCY_GOOD_MS) return 'good';
    if (pingMs <= PEER_LATENCY_FAIR_MS) return 'fair';
    return 'poor';
  }
  if (connectionQuality === 'excellent') return 'good';
  if (connectionQuality === 'good') return 'fair';
  if (connectionQuality === 'poor') return 'poor';
  if (connectionQuality === 'lost') return 'lost';
  return 'unknown';
}

function getPeerConnectionQualityLabel(connectionQuality) {
  if (connectionQuality === 'excellent') return 'OK';
  if (connectionQuality === 'good') return 'OK';
  if (connectionQuality === 'poor') return 'LOW';
  if (connectionQuality === 'lost') return '--';
  return '--';
}

function getPeerConnectionState(peer) {
  return peer.pc?.connectionState || peer.pc?.iceConnectionState || '';
}

function isPeerConnected(peer) {
  const stateText = getPeerConnectionState(peer);
  return stateText === 'connected' || stateText === 'completed';
}

function isPeerDisconnected(peer) {
  const stateText = getPeerConnectionState(peer);
  return stateText === 'closed' || stateText === 'disconnected' || stateText === 'failed';
}

function setParticipantStatus(peer, label) {
  peer.status.textContent = label;
  peer.status.hidden = !label;
}

function refreshParticipantState() {
  const participantCount = elements.participants.children.length;
  elements.participants.dataset.count = String(Math.min(participantCount, 8));
  elements.emptyRoom.hidden = participantCount > 0;
}

async function unlockAudio() {
  await state.audioContext?.resume();
  await Promise.allSettled(getMicrophoneProcessors(state.micProcessor).map((processor) => processor.context?.resume()));
  const plays = [];
  for (const peer of state.peers.values()) {
    for (const audio of peer.audioElements.values()) plays.push(audio.play());
  }
  if (!elements.screenStage.hidden) plays.push(elements.screenVideo.play());
  await Promise.allSettled(plays);
  elements.soundButton.hidden = true;
}

async function copyRoomCode() {
  await copyText(state.roomId);
  showToast('Код комнаты скопирован');
}

async function copyRoomLink() {
  const roomUrl = new URL(`/r/${encodeURIComponent(state.roomId)}`, window.location.origin);
  await copyText(roomUrl.href);
  showToast('Ссылка на комнату скопирована');
}

function getDisplayName() {
  return state.savedName || 'Гость';
}

function saveNameFromInput(input) {
  const name = cleanDisplayName(input.value);
  if (!name) {
    showToast('Введите имя');
    input.focus();
    return '';
  }

  state.savedName = name;
  persistName(name);
  elements.startNameInput.value = name;
  updateNameStatuses();
  showToast('Имя сохранено');
  return name;
}

function persistName(name) {
  state.savedName = name;
  localStorage.setItem('voice-room:name', name);
  elements.startNameInput.value = name;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    const temporaryInput = document.createElement('input');
    temporaryInput.value = text;
    document.body.append(temporaryInput);
    temporaryInput.select();
    document.execCommand('copy');
    temporaryInput.remove();
  }
}

function requireSavedName(input) {
  const currentName = cleanDisplayName(input.value);

  if (!state.savedName) {
    showToast('Сначала сохраните имя');
    input.focus();
    return false;
  }

  if (currentName && currentName !== state.savedName) {
    showToast('Сохраните новое имя');
    input.focus();
    return false;
  }

  if (!currentName) input.value = state.savedName;
  updateNameStatuses();
  return true;
}

function updateNameStatuses() {
  renderNameStatus(elements.startNameInput, elements.startNameStatus);
}

function renderNameStatus(input, status) {
  const currentName = cleanDisplayName(input.value);

  if (state.savedName && currentName === state.savedName) {
    status.textContent = `Сохранено: ${state.savedName}`;
    status.dataset.state = 'saved';
    return;
  }

  if (state.savedName && currentName && currentName !== state.savedName) {
    status.textContent = 'Новое имя еще не сохранено';
    status.dataset.state = 'dirty';
    return;
  }

  status.textContent = 'Имя не сохранено';
  status.dataset.state = 'empty';
}

function cleanDisplayName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 40);
}

function extractRoomId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    const url = new URL(raw, window.location.origin);
    const match = url.pathname.match(/^\/r\/([A-Za-z0-9_-]{3,48})\/?$/);
    if (match) return match[1];
  } catch (error) {
    // Plain room codes are handled below.
  }

  const routeMatch = raw.match(/(?:^|\/)r\/([A-Za-z0-9_-]{3,48})\/?$/);
  if (routeMatch) return routeMatch[1];

  const compact = raw.replace(/^#/, '').trim();
  return /^[A-Za-z0-9_-]{3,48}$/.test(compact) ? compact : '';
}

function getInitials(name) {
  const words = String(name || 'Гость').trim().split(/\s+/);
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

function applyParticipantPalette(node, peerInfo) {
  const seed = `${peerInfo.id || ''}:${peerInfo.name || ''}`;
  const hue = hashStringToHue(seed);
  node.style.setProperty('--participant-pastel', `oklch(84% 0.075 ${hue})`);
}

function hashStringToHue(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index);
  }

  return ((hash % 360) + 360) % 360;
}

function setStatus(stateName, label) {
  elements.statusPill.dataset.state = stateName;
  elements.statusText.textContent = label;
  elements.statusPill.hidden = stateName === 'idle' || stateName === 'connected';
}

function showToast(message, options = {}) {
  const { duration = 2400, variant = 'info' } = options || {};
  elements.toast.textContent = message;
  elements.toast.dataset.variant = variant;
  elements.toast.dataset.visible = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    elements.toast.dataset.visible = 'false';
  }, duration);
}
