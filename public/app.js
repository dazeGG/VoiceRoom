'use strict';

const $ = (selector) => document.querySelector(selector);
const DEFAULT_NOISE_MODE = 'browser';
const NOTIFICATION_VOLUME_BOOST = 2.2;
const NOISE_MODE_STORAGE_KEY = 'voice-room:noise-mode';
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
  joinByCodeButton: $('#joinByCodeButton'),
  leaveButton: $('#leaveButton'),
  muteButton: $('#muteButton'),
  muteText: $('#muteText'),
  noiseModeSelect: $('#noiseModeSelect'),
  notFoundScreen: $('#notFoundScreen'),
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
  iceConfig: { iceServers: [] },
  iceRefreshTimer: 0,
  joined: false,
  localRawStream: null,
  localScreenStream: null,
  localScreenProfileId: DEFAULT_SCREEN_PROFILE_ID,
  localStream: null,
  micProcessor: null,
  muted: false,
  noiseMode: getStoredNoiseMode(),
  peers: new Map(),
  peerId: createPeerId(),
  roomId: getRoomIdFromPath(),
  roomRoute: window.location.pathname.startsWith('/r/'),
  savedName: '',
  screenFullscreen: false,
  screenMuted: false,
  screenRequesting: false,
  screenStopping: false,
  screenVolume: 1,
  self: null,
  sessionToken: createSessionToken(),
  sharedScreenPeerId: '',
  viewedScreenPeerId: ''
};

let toastTimer = null;
let meterFrame = 0;
let rnnoiseModulePromise = null;

init();

function init() {
  const savedName = cleanDisplayName(localStorage.getItem('voice-room:name'));
  state.savedName = savedName;
  elements.startNameInput.value = savedName;
  elements.noiseModeSelect.value = state.noiseMode;
  elements.startForm.addEventListener('submit', saveStartName);
  elements.createRoomButton.addEventListener('click', createRoomFromStart);
  elements.joinByCodeButton.addEventListener('click', joinRoomByCode);
  elements.roomCodeInput.addEventListener('keydown', handleRoomCodeKeydown);
  elements.startNameInput.addEventListener('input', updateNameStatuses);
  renderScreenProfileOptions();
  elements.copyCodeButton.addEventListener('click', copyRoomCode);
  elements.copyLinkButton.addEventListener('click', copyRoomLink);
  elements.muteButton.addEventListener('click', handleMicButtonClick);
  elements.screenButton.addEventListener('click', handleScreenButtonClick);
  elements.screenExitButton.addEventListener('click', () => leaveScreenView().catch((error) => console.error(error)));
  elements.screenFullscreenButton.addEventListener('click', toggleScreenFullscreen);
  elements.streamVolumeButton.addEventListener('click', toggleScreenMute);
  elements.streamVolumeSlider.addEventListener('input', updateScreenVolumeFromSlider);
  syncScreenVideoAudio();
  elements.deviceMenuButton.addEventListener('click', toggleDevicePopover);
  elements.leaveButton.addEventListener('click', handleLeaveButtonClick);
  elements.soundButton.addEventListener('click', unlockAudio);
  elements.deviceSelect.addEventListener('change', switchMicrophone);
  elements.noiseModeSelect.addEventListener('change', switchNoiseMode);
  document.addEventListener('click', closeDevicePopoverOnOutside);
  document.addEventListener('click', closeScreenProfileOnOutside);
  document.addEventListener('keydown', closeDevicePopoverOnEscape);
  document.addEventListener('keydown', closeScreenProfileOnEscape);
  document.addEventListener('fullscreenchange', updateScreenFullscreenState);
  window.addEventListener('beforeunload', leaveRoom);

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

function setNoiseMode(mode) {
  state.noiseMode = getNoiseMode(mode);
  elements.noiseModeSelect.value = state.noiseMode;
  localStorage.setItem(NOISE_MODE_STORAGE_KEY, state.noiseMode);
}

function getNoiseModeLabel(mode) {
  return NOISE_MODES[getNoiseMode(mode)].label;
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

  state.connecting = true;
  elements.muteButton.disabled = true;
  setStatus('connecting', 'соединение');
  refreshCallControls();

  try {
    const exists = await checkRoomExists(state.roomId);
    if (!exists) {
      showRoomNotFound();
      return;
    }

    setLocalMicrophoneCapture(await openLocalMicrophone());
    await refreshDevices();

    const name = getDisplayName();
    state.self = createParticipant({
      id: state.peerId,
      isLocal: true,
      joinedAt: Date.now(),
      muted: false,
      name
    });
    attachMeter(state.self, state.localStream);
    updatePeerStatus(state.self);

    state.eventSource = new EventSource(
      `/events?room=${encodeURIComponent(state.roomId)}&peer=${encodeURIComponent(state.peerId)}&token=${encodeURIComponent(state.sessionToken)}&name=${encodeURIComponent(name)}`
    );
    state.eventSource.onmessage = handleServerMessage;
    state.eventSource.onerror = () => {
      if (state.joined) setStatus('connecting', 'переподключение');
    };

    state.joined = true;
    refreshCallControls();
    refreshScreenControls();
    startMeters();
    playPeerCue('join');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Не удалось подключиться');
    setStatus('error', 'ошибка');
    stopLocalStream();
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

async function openMicrophone(mode = state.noiseMode) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Браузер не дал доступ к микрофону. Нужен HTTPS или localhost.');
  }

  const noiseMode = NOISE_MODES[getNoiseMode(mode)];
  const deviceId = elements.deviceSelect.value;
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
    return {
      mode,
      processor: null,
      rawStream,
      stream: rawStream
    };
  }

  try {
    return await createNoiseSuppressedStream(rawStream);
  } catch (error) {
    console.warn('RNNoise unavailable', error);
    stopStream(rawStream);
    setNoiseMode('browser');
    showToast('RNNoise недоступен, включен браузерный шумодав');
    const fallbackStream = await openMicrophone('browser');
    return {
      mode: 'browser',
      processor: null,
      rawStream: fallbackStream,
      stream: fallbackStream
    };
  }
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
  disconnectAudioNode(capture.processor?.source);
  disconnectAudioNode(capture.processor?.node);
  disconnectAudioNode(capture.processor?.destination);
  capture.processor?.context.close().catch(() => {});

  const streams = new Set([capture.stream, capture.rawStream].filter(Boolean));
  for (const stream of streams) stopStream(stream);
}

function disconnectAudioNode(node) {
  try {
    node?.disconnect();
  } catch {
    // The graph may already be partially disconnected after a failed worklet setup.
  }
}

async function openScreenShare(profile) {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('Браузер не поддерживает демонстрацию экрана. Нужен HTTPS или localhost.');
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    audio: {
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
      suppressLocalAudioPlayback: false
    },
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
    systemAudio: 'include',
    video: {
      frameRate: { ideal: profile.frameRate, max: profile.frameRate },
      height: { ideal: profile.height, max: profile.height },
      width: { ideal: profile.width, max: profile.width }
    }
  });

  await applyScreenCaptureProfile(stream, profile);
  return stream;
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
    videoTrack.addEventListener('ended', () => {
      stopScreenShare({ fromBrowser: true }).catch((error) => console.error(error));
    });

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
    if (error.name !== 'NotAllowedError') console.error(error);
    if (state.localScreenStream) {
      await stopScreenShare({ notify: false, quiet: true }).catch((cleanupError) => console.error(cleanupError));
    }
    showToast(error.name === 'NotAllowedError' ? 'Демонстрация отменена' : error.message || 'Не удалось показать экран');
  } finally {
    elements.screenButton.disabled = false;
    refreshScreenControls();
  }
}

async function stopScreenShare(options = {}) {
  if (!state.localScreenStream || state.screenStopping) return;

  state.screenStopping = true;
  try {
    const { notify = true, quiet = false, renegotiate = true } = options;
    const previousStream = state.localScreenStream;
    state.localScreenStream = null;

    stopStream(previousStream);

    for (const peer of state.peers.values()) {
      removeLocalScreenTracks(peer);
      peer.screenSubscribed = false;
      if (renegotiate) await renegotiatePeer(peer);
    }

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

  const currentValue = elements.deviceSelect.value;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const microphones = devices.filter((device) => device.kind === 'audioinput');
  elements.deviceSelect.textContent = '';

  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = 'Системный';
  elements.deviceSelect.append(defaultOption);

  microphones.forEach((device, index) => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || `Микрофон ${index + 1}`;
    elements.deviceSelect.append(option);
  });

  if ([...elements.deviceSelect.options].some((option) => option.value === currentValue)) {
    elements.deviceSelect.value = currentValue;
  }
}

async function switchMicrophone(options = {}) {
  const {
    failureMessage = 'Не удалось переключить микрофон',
    refreshDeviceList = true,
    successMessage = 'Микрофон переключен'
  } = options;
  refreshCallControls();
  if (!state.joined || !state.localStream) return false;

  let nextCapture = null;
  try {
    const previousCapture = getLocalMicrophoneCapture();
    nextCapture = await openLocalMicrophone();
    const [nextTrack] = nextCapture.stream.getAudioTracks();
    if (!nextTrack) throw new Error('Браузер не отдал аудио-трек');

    for (const peer of state.peers.values()) {
      const sender = peer.micSender || peer.pc?.getSenders().find((item) => item.track?.kind === 'audio');
      if (sender && nextTrack) {
        await sender.replaceTrack(nextTrack);
        peer.micSender = sender;
      }
    }

    setLocalMicrophoneCapture(nextCapture);
    stopMicrophoneCapture(previousCapture);
    attachMeter(state.self, state.localStream);
    if (refreshDeviceList) await refreshDevices();
    showToast(typeof successMessage === 'function' ? successMessage(nextCapture) : successMessage);
    return true;
  } catch (error) {
    console.error(error);
    if (nextCapture) stopMicrophoneCapture(nextCapture);
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

async function handleServerMessage(event) {
  const message = JSON.parse(event.data);

  if (message.type === 'hello') {
    applyIceConfig(message.iceConfig);
    setStatus('connected', '');
    syncPeers(message.peers.map((peer) => peer.id));
    for (const peer of message.peers) {
      createParticipant(peer);
      await callPeer(peer.id);
    }
    refreshParticipantState();
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
  const existing = peerInfo.isLocal ? state.self : state.peers.get(peerInfo.id);
  if (existing) {
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
  if (peerInfo.isLocal) node.dataset.local = 'true';
  avatar.textContent = getInitials(peerInfo.name);
  nameLabel.textContent = peerInfo.isLocal ? `${peerInfo.name} · вы` : peerInfo.name;
  setParticipantStatus({ status }, peerInfo.isLocal ? '' : 'подключение');
  node.dataset.muted = String(Boolean(peerInfo.muted));
  node.dataset.screen = String(Boolean(peerInfo.screen));

  elements.participants.append(node);

  const participant = {
    analyser: null,
    audioElements: new Map(),
    id: peerInfo.id,
    isLocal: Boolean(peerInfo.isLocal),
    localScreenSenders: [],
    makingOffer: false,
    micSender: null,
    meterData: null,
    muted: Boolean(peerInfo.muted),
    name: peerInfo.name,
    needsRenegotiate: false,
    node,
    pendingCandidates: [],
    pc: null,
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
  if (!participant.isLocal) state.peers.set(peerInfo.id, participant);
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
  if (Object.hasOwn(peerInfo, 'muted')) participant.muted = Boolean(peerInfo.muted);
  if (hasScreenUpdate) participant.screen = Boolean(peerInfo.screen);
  if (Object.hasOwn(peerInfo, 'screenAudio')) participant.screenAudio = Boolean(peerInfo.screenAudio);
  if (Object.hasOwn(peerInfo, 'screenStreamId')) participant.screenStreamId = peerInfo.screenStreamId || '';
  participant.node.dataset.muted = String(participant.muted);
  participant.node.dataset.screen = String(participant.screen);
  participant.node.querySelector('.avatar').textContent = getInitials(participant.name);
  participant.node.querySelector('.participant-name').textContent = participant.isLocal ? `${participant.name} · вы` : participant.name;
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
  removeAudioElements(peer);
  if (state.viewedScreenPeerId === peer.id) {
    closeScreenView();
  }
  if (state.sharedScreenPeerId === peer.id) {
    hideScreenStage();
  }
  peer.node.remove();
  state.peers.delete(peerId);
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

  for (const track of state.localStream.getTracks()) {
    const sender = pc.addTrack(track, state.localStream);
    if (track.kind === 'audio') peer.micSender = sender;
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
    attachRemoteTrack(peer, event.track, stream);
  });

  pc.addEventListener('connectionstatechange', () => updatePeerStatus(peer));
  pc.addEventListener('signalingstatechange', () => {
    if (pc.signalingState === 'stable' && peer.needsRenegotiate) {
      peer.needsRenegotiate = false;
      renegotiatePeer(peer).catch((error) => console.error(error));
    }
  });
  pc.addEventListener('iceconnectionstatechange', () => {
    if (pc.iceConnectionState === 'failed') {
      pc.restartIce();
    }
    updatePeerStatus(peer);
  });

  updatePeerStatus(peer);
  return pc;
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
    encoding.maxBitrate = SCREEN_AUDIO_BITRATE;
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
  const peer = state.peers.get(from) || createParticipant({ id: from, muted: false, name: 'Гость' });
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

function attachRemoteTrack(peer, track, stream) {
  const mediaStream = stream || new MediaStream([track]);
  const isScreenStream = track.kind === 'video' || (peer.screenStreamId && mediaStream.id === peer.screenStreamId);

  if (isScreenStream) {
    attachRemoteScreenStream(peer, mediaStream);
    return;
  }

  if (track.kind === 'audio') {
    peer.stream = mediaStream;
    attachRemoteAudioTrack(peer, track);
    if (!peer.analyser) attachMeter(peer, new MediaStream([track]));
    updatePeerStatus(peer);
  }
}

function attachRemoteScreenStream(peer, stream) {
  peer.screen = true;
  peer.screenStream = stream;
  peer.screenAudio = peer.screenAudio || stream.getAudioTracks().some((track) => track.readyState !== 'ended');
  peer.screenStreamId ||= stream.id;
  peer.node.dataset.screen = 'true';

  for (const track of stream.getVideoTracks()) {
    track.addEventListener('ended', () => detachRemoteScreen(peer), { once: true });
  }
  for (const track of stream.getAudioTracks()) {
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
    sendSignal(peer.id, 'screen-unsubscribe', { active: false }).catch(() => {});
    detachRemoteScreen(peer);
    return;
  }

  state.screenRequesting = false;
  refreshAllScreenActions();
  refreshScreenStage();
  updatePeerStatus(peer);
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
  audio.playsInline = true;
  audio.srcObject = new MediaStream([track]);
  peer.audioElements.set(track.id, audio);
  document.body.append(audio);
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

function removeAudioElements(peer) {
  for (const audio of peer.audioElements.values()) {
    audio.remove();
  }
  peer.audioElements.clear();
}

function attachMeter(participant, stream) {
  if (!participant || !stream) return;
  try {
    state.audioContext ||= new AudioContext();
    const source = state.audioContext.createMediaStreamSource(stream);
    const analyser = state.audioContext.createAnalyser();
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

function updateMeter(participant) {
  if (!participant?.analyser || !participant.meterData) return;

  participant.analyser.getByteTimeDomainData(participant.meterData);
  let sum = 0;
  for (const value of participant.meterData) {
    const centered = value - 128;
    sum += centered * centered;
  }

  const level = Math.min(1, Math.sqrt(sum / participant.meterData.length) / 48);
  const visibleLevel = participant.muted ? 0 : level;
  participant.node.style.setProperty('--level', visibleLevel.toFixed(3));
  participant.node.dataset.speaking = String(visibleLevel > 0.08);
}

function getCueGain(value) {
  return value * NOTIFICATION_VOLUME_BOOST;
}

function playPeerCue(type) {
  try {
    state.audioContext ||= new AudioContext();
    const context = state.audioContext;
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
  try {
    state.audioContext ||= new AudioContext();
    const context = state.audioContext;
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

function playStreamCue(type) {
  try {
    state.audioContext ||= new AudioContext();
    const context = state.audioContext;
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
  if (!response.ok) throw new Error('Сигналинг недоступен');
  return response.json();
}

function toggleMute() {
  if (!state.localStream) return;
  state.muted = !state.muted;
  setMicrophoneCaptureEnabled(getLocalMicrophoneCapture(), !state.muted);

  playMicCue(state.muted);
  elements.muteButton.setAttribute('aria-pressed', String(state.muted));
  refreshCallControls();
  updateParticipant({
    id: state.peerId,
    muted: state.muted,
    name: getDisplayName()
  });
  postState().catch(() => {});
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

function toggleScreenProfilePopover() {
  if (!state.joined || state.connecting) {
    showToast('Сначала подключитесь к комнате');
    return;
  }
  closeDevicePopover();
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

  try {
    await sendSignal(peerId, 'screen-subscribe', { active: true });
  } catch (error) {
    console.error(error);
    closeScreenView();
    showToast('Не удалось подключиться к экрану');
  }
}

async function leaveScreenView(options = {}) {
  const { quiet = false } = options;
  const peerId = closeScreenView();
  if (!peerId || !state.peers.has(peerId)) return;

  try {
    await sendSignal(peerId, 'screen-unsubscribe', { active: false });
  } catch (error) {
    console.error(error);
    if (!quiet) showToast('Не удалось отключить просмотр');
  }
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
}

function syncScreenVideoAudio() {
  const muted = state.screenMuted || state.screenVolume <= 0;
  elements.screenVideo.volume = state.screenVolume;
  elements.screenVideo.muted = muted;
  elements.streamVolumeSlider.value = String(Math.round(state.screenVolume * 100));
  elements.streamVolumeButton.dataset.muted = String(muted);
  elements.streamVolumeButton.setAttribute('aria-pressed', String(muted));
  elements.streamVolumeButton.setAttribute('aria-label', muted ? 'Включить звук стрима' : 'Выключить звук стрима');
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
  if (!document.fullscreenEnabled) {
    showToast('Полноэкранный режим недоступен');
    return;
  }

  try {
    if (document.fullscreenElement === elements.screenStage) {
      await document.exitFullscreen();
    } else {
      await elements.screenStage.requestFullscreen();
    }
  } catch (error) {
    console.error(error);
    showToast('Не удалось переключить полноэкранный режим');
  }
}

function updateScreenFullscreenState() {
  const fullscreen = document.fullscreenElement === elements.screenStage;
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
  window.clearTimeout(state.iceRefreshTimer);
  state.iceRefreshTimer = 0;
  state.eventSource?.close();
  state.eventSource = null;
  closeScreenView();

  for (const peer of state.peers.values()) {
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

  state.muted = false;
  refreshCallControls();
  refreshScreenControls();
  closeDevicePopover();
  closeScreenProfilePopover();
  setStatus('idle', 'готово');
  refreshParticipantState();
}

function stopLocalStream() {
  stopMicrophoneCapture(getLocalMicrophoneCapture());
  state.localStream = null;
  state.localRawStream = null;
  state.micProcessor = null;
}

function stopStream(stream) {
  for (const track of stream.getTracks()) track.stop();
}

function stopLocalScreenStream() {
  if (!state.localScreenStream) return;
  stopStream(state.localScreenStream);
  state.localScreenStream = null;
  state.screenStopping = false;
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
  if (peer.screen) {
    setParticipantStatus(peer, peer.isLocal ? 'экран в эфире' : 'показывает экран');
    return;
  }

  if (peer.muted) {
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
  await state.micProcessor?.context.resume();
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

function setStatus(stateName, label) {
  elements.statusPill.dataset.state = stateName;
  elements.statusText.textContent = label;
  elements.statusPill.hidden = stateName === 'idle' || stateName === 'connected';
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.dataset.visible = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    elements.toast.dataset.visible = 'false';
  }, 2400);
}
