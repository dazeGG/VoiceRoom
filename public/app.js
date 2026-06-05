'use strict';

const $ = (selector) => document.querySelector(selector);

const elements = {
  copyCodeButton: $('#copyCodeButton'),
  createRoomButton: $('#createRoomButton'),
  deviceMenuButton: $('#deviceMenuButton'),
  devicePopover: $('#devicePopover'),
  deviceSelect: $('#deviceSelect'),
  emptyRoom: $('#emptyRoom'),
  joinByCodeButton: $('#joinByCodeButton'),
  leaveButton: $('#leaveButton'),
  muteButton: $('#muteButton'),
  muteText: $('#muteText'),
  networkIndicator: $('#networkIndicator'),
  networkTooltip: $('#networkTooltip'),
  participants: $('#participants'),
  roomCodeInput: $('#roomCodeInput'),
  roomScreen: $('#roomScreen'),
  roomTitle: $('#roomTitle'),
  soundButton: $('#soundButton'),
  startForm: $('#startForm'),
  startNameInput: $('#startNameInput'),
  startNameStatus: $('#startNameStatus'),
  startScreen: $('#startScreen'),
  statusPill: $('#statusPill'),
  statusText: $('#statusText'),
  template: $('#participantTemplate'),
  toast: $('#toast')
};

const state = {
  audioContext: null,
  autoJoinStarted: false,
  connecting: false,
  eventSource: null,
  iceConfig: { iceServers: [] },
  joined: false,
  localStream: null,
  muted: false,
  networkTimer: 0,
  peers: new Map(),
  pingMs: null,
  peerId: createPeerId(),
  roomId: getRoomIdFromPath(),
  savedName: '',
  self: null
};

let toastTimer = null;
let meterFrame = 0;

init();

function init() {
  const savedName = cleanDisplayName(localStorage.getItem('voice-room:name'));
  state.savedName = savedName;
  elements.startNameInput.value = savedName;
  elements.startForm.addEventListener('submit', saveStartName);
  elements.createRoomButton.addEventListener('click', createRoomFromStart);
  elements.joinByCodeButton.addEventListener('click', joinRoomByCode);
  elements.roomCodeInput.addEventListener('keydown', handleRoomCodeKeydown);
  elements.startNameInput.addEventListener('input', updateNameStatuses);
  elements.copyCodeButton.addEventListener('click', copyRoomCode);
  elements.muteButton.addEventListener('click', handleMicButtonClick);
  elements.deviceMenuButton.addEventListener('click', toggleDevicePopover);
  elements.leaveButton.addEventListener('click', handleLeaveButtonClick);
  elements.soundButton.addEventListener('click', unlockAudio);
  elements.deviceSelect.addEventListener('change', switchMicrophone);
  elements.networkIndicator.addEventListener('pointerenter', showNetworkTooltip);
  elements.networkIndicator.addEventListener('pointerleave', hideNetworkTooltip);
  elements.networkIndicator.addEventListener('focus', showNetworkTooltip);
  elements.networkIndicator.addEventListener('blur', hideNetworkTooltip);
  document.addEventListener('click', closeDevicePopoverOnOutside);
  document.addEventListener('keydown', closeDevicePopoverOnEscape);
  window.addEventListener('beforeunload', leaveRoom);

  if (state.roomId) {
    showRoomScreen();
    refreshDevices().catch(() => {});
  } else {
    showStartScreen();
  }
}

function getRoomIdFromPath() {
  const match = window.location.pathname.match(/^\/r\/([A-Za-z0-9_-]{3,48})\/?$/);
  return match ? match[1] : '';
}

function createRoomId() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

function createPeerId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function hideScreens() {
  elements.startScreen.hidden = true;
  elements.roomScreen.hidden = true;
}

function showStartScreen() {
  document.body.dataset.screen = 'start';
  document.title = 'Voice Room';
  hideScreens();
  elements.startScreen.hidden = false;
  elements.statusPill.hidden = true;
  updateNameStatuses();
}

function showRoomScreen() {
  document.body.dataset.screen = 'room';
  document.title = `${state.roomId} · Voice Room`;
  elements.roomTitle.textContent = state.roomId;
  hideScreens();
  elements.roomScreen.hidden = false;
  elements.statusPill.hidden = true;

  if (!ensureNameForRoomLink()) {
    window.location.href = '/';
    return;
  }

  updateNameStatuses();
  refreshCallControls();
  refreshParticipantState();
  startNetworkMonitor();
  autoJoinRoom();
}

function saveStartName(event) {
  event.preventDefault();
  saveNameFromInput(elements.startNameInput);
}

function createRoomFromStart() {
  if (!requireSavedName(elements.startNameInput)) return;
  openRoom(createRoomId());
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
    state.iceConfig = await fetchJson('/config');
    state.localStream = await openMicrophone();
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
      `/events?room=${encodeURIComponent(state.roomId)}&peer=${encodeURIComponent(state.peerId)}&name=${encodeURIComponent(name)}`
    );
    state.eventSource.onmessage = handleServerMessage;
    state.eventSource.onerror = () => {
      if (state.joined) setStatus('connecting', 'переподключение');
    };

    state.joined = true;
    refreshCallControls();
    startMeters();
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Не удалось подключиться');
    setStatus('error', 'ошибка');
    stopLocalStream();
  } finally {
    state.connecting = false;
    elements.muteButton.disabled = false;
    refreshCallControls();
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

async function openMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Браузер не дал доступ к микрофону. Нужен HTTPS или localhost.');
  }

  const deviceId = elements.deviceSelect.value;
  return navigator.mediaDevices.getUserMedia({
    audio: {
      autoGainControl: true,
      channelCount: 1,
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: true,
      noiseSuppression: true
    },
    video: false
  });
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

async function switchMicrophone() {
  refreshCallControls();
  if (!state.joined || !state.localStream) return;

  try {
    const nextStream = await openMicrophone();
    const [nextTrack] = nextStream.getAudioTracks();
    const [oldTrack] = state.localStream.getAudioTracks();

    for (const peer of state.peers.values()) {
      const sender = peer.pc?.getSenders().find((item) => item.track?.kind === 'audio');
      if (sender && nextTrack) {
        await sender.replaceTrack(nextTrack);
      }
    }

    oldTrack?.stop();
    state.localStream = nextStream;
    if (state.muted && nextTrack) nextTrack.enabled = false;
    attachMeter(state.self, state.localStream);
    await refreshDevices();
    showToast('Микрофон переключен');
  } catch (error) {
    console.error(error);
    showToast('Не удалось переключить микрофон');
  }
}

async function handleServerMessage(event) {
  const message = JSON.parse(event.data);

  if (message.type === 'hello') {
    setStatus('connected', '');
    syncPeers(message.peers.map((peer) => peer.id));
    for (const peer of message.peers) {
      createParticipant(peer);
      await callPeer(peer.id);
    }
    refreshParticipantState();
    return;
  }

  if (message.type === 'peer-joined') {
    createParticipant(message.peer);
    refreshParticipantState();
    return;
  }

  if (message.type === 'peer-left') {
    removePeer(message.peerId);
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
  const title = fragment.querySelector('h2');
  const status = fragment.querySelector('p');

  node.dataset.peerId = peerInfo.id;
  if (peerInfo.isLocal) node.dataset.local = 'true';
  avatar.textContent = getInitials(peerInfo.name);
  title.textContent = peerInfo.isLocal ? `${peerInfo.name} · вы` : peerInfo.name;
  setParticipantStatus({ status }, peerInfo.isLocal ? '' : 'подключение');
  node.dataset.muted = String(Boolean(peerInfo.muted));

  elements.participants.append(node);

  const participant = {
    analyser: null,
    audio: null,
    id: peerInfo.id,
    isLocal: Boolean(peerInfo.isLocal),
    meterData: null,
    muted: Boolean(peerInfo.muted),
    name: peerInfo.name,
    node,
    pendingCandidates: [],
    pc: null,
    status,
    stream: null
  };

  if (!participant.isLocal) state.peers.set(peerInfo.id, participant);
  refreshParticipantState();
  return participant;
}

function updateParticipant(peerInfo) {
  const participant = peerInfo.id === state.peerId ? state.self : state.peers.get(peerInfo.id);
  if (!participant) return;

  participant.name = peerInfo.name || participant.name;
  participant.muted = Boolean(peerInfo.muted);
  participant.node.dataset.muted = String(participant.muted);
  participant.node.querySelector('.avatar').textContent = getInitials(participant.name);
  participant.node.querySelector('h2').textContent = participant.isLocal ? `${participant.name} · вы` : participant.name;
  updatePeerStatus(participant);
}

function removePeer(peerId) {
  const peer = state.peers.get(peerId);
  if (!peer) return;

  peer.pc?.close();
  peer.audio?.remove();
  peer.node.remove();
  state.peers.delete(peerId);
}

async function callPeer(peerId) {
  const peer = state.peers.get(peerId);
  if (!peer) return;

  const pc = ensurePeerConnection(peer);
  const offer = await pc.createOffer({ offerToReceiveAudio: true });
  await pc.setLocalDescription(offer);
  await sendSignal(peer.id, 'offer', pc.localDescription);
}

function ensurePeerConnection(peer) {
  if (peer.pc) return peer.pc;

  const pc = new RTCPeerConnection(state.iceConfig);
  peer.pc = pc;

  for (const track of state.localStream.getTracks()) {
    pc.addTrack(track, state.localStream);
  }

  pc.addEventListener('icecandidate', (event) => {
    if (event.candidate) {
      sendSignal(peer.id, 'candidate', event.candidate).catch(() => {});
    }
  });

  pc.addEventListener('track', (event) => {
    const [stream] = event.streams;
    if (stream) attachRemoteStream(peer, stream);
  });

  pc.addEventListener('connectionstatechange', () => updatePeerStatus(peer));
  pc.addEventListener('iceconnectionstatechange', () => {
    if (pc.iceConnectionState === 'failed') {
      pc.restartIce();
    }
    updatePeerStatus(peer);
  });

  updatePeerStatus(peer);
  return pc;
}

async function handleSignal(from, signalType, payload) {
  const peer = state.peers.get(from) || createParticipant({ id: from, muted: false, name: 'Гость' });
  const pc = ensurePeerConnection(peer);

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

async function flushCandidates(peer) {
  while (peer.pendingCandidates.length > 0) {
    const candidate = peer.pendingCandidates.shift();
    await peer.pc.addIceCandidate(candidate);
  }
}

function attachRemoteStream(peer, stream) {
  peer.stream = stream;
  if (!peer.audio) {
    peer.audio = document.createElement('audio');
    peer.audio.autoplay = true;
    peer.audio.playsInline = true;
    document.body.append(peer.audio);
  }
  peer.audio.srcObject = stream;
  peer.audio.play().catch(() => {
    elements.soundButton.hidden = false;
  });
  attachMeter(peer, stream);
  updatePeerStatus(peer);
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

async function sendSignal(to, signalType, payload) {
  return postJson('/signal', {
    from: state.peerId,
    payload,
    roomId: state.roomId,
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
    roomId: state.roomId
  });
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Сервер недоступен');
  return response.json();
}

async function measurePing() {
  const startedAt = performance.now();
  try {
    await fetchJson(`/healthz?t=${Date.now()}`);
    state.pingMs = Math.max(1, Math.round(performance.now() - startedAt));
  } catch (error) {
    state.pingMs = null;
  }
  refreshNetworkIndicator();
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
  for (const track of state.localStream.getAudioTracks()) {
    track.enabled = !state.muted;
  }

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

function handleLeaveButtonClick() {
  if (state.joined || state.localStream || state.connecting) {
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

function startNetworkMonitor() {
  if (state.networkTimer) return;

  measurePing().catch(() => {});
  state.networkTimer = window.setInterval(() => {
    measurePing().catch(() => {});
  }, 5000);
}

function stopNetworkMonitor() {
  if (!state.networkTimer) return;
  window.clearInterval(state.networkTimer);
  state.networkTimer = 0;
}

function refreshNetworkIndicator() {
  const ping = state.pingMs;
  const quality = ping == null ? 'unknown' : ping < 120 ? 'good' : ping < 260 ? 'warn' : 'bad';
  const label = ping == null ? '— мс' : `${ping} мс`;
  const ariaLabel = ping == null ? 'Пинг недоступен' : `Пинг ${label}`;

  elements.networkIndicator.dataset.state = quality;
  elements.networkIndicator.dataset.tooltip = label;
  elements.networkIndicator.removeAttribute('title');
  elements.networkIndicator.setAttribute('aria-label', ariaLabel);
  elements.networkTooltip.textContent = label;
}

function showNetworkTooltip() {
  elements.networkIndicator.dataset.tooltipOpen = 'true';
}

function hideNetworkTooltip() {
  delete elements.networkIndicator.dataset.tooltipOpen;
}

function leaveRoom() {
  if (!state.joined && !state.localStream && !state.connecting) return;

  state.connecting = false;
  state.joined = false;
  state.eventSource?.close();
  state.eventSource = null;

  for (const peer of state.peers.values()) {
    peer.pc?.close();
    peer.audio?.remove();
    peer.node.remove();
  }
  state.peers.clear();

  state.self?.node.remove();
  state.self = null;
  stopLocalStream();
  stopMeters();
  stopNetworkMonitor();

  state.muted = false;
  state.pingMs = null;
  refreshCallControls();
  refreshNetworkIndicator();
  closeDevicePopover();
  setStatus('idle', 'готово');
  refreshParticipantState();
}

function stopLocalStream() {
  if (!state.localStream) return;
  for (const track of state.localStream.getTracks()) track.stop();
  state.localStream = null;
}

function updatePeerStatus(peer) {
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
  const plays = [];
  for (const peer of state.peers.values()) {
    if (peer.audio) plays.push(peer.audio.play());
  }
  await Promise.allSettled(plays);
  elements.soundButton.hidden = true;
}

async function copyRoomCode() {
  await copyText(state.roomId);
  showToast('Код комнаты скопирован');
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
