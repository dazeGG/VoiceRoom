'use strict';

const $ = (selector) => document.querySelector(selector);

const elements = {
  controls: $('#controls'),
  copyLinkButton: $('#copyLinkButton'),
  deviceSelect: $('#deviceSelect'),
  emptyRoom: $('#emptyRoom'),
  joinButton: $('#joinButton'),
  joinForm: $('#joinForm'),
  leaveButton: $('#leaveButton'),
  muteButton: $('#muteButton'),
  muteText: $('#muteText'),
  nameInput: $('#nameInput'),
  newRoomButton: $('#newRoomButton'),
  participants: $('#participants'),
  roomLink: $('#roomLink'),
  roomTitle: $('#roomTitle'),
  soundButton: $('#soundButton'),
  statusPill: $('#statusPill'),
  statusText: $('#statusText'),
  template: $('#participantTemplate'),
  toast: $('#toast')
};

const state = {
  audioContext: null,
  eventSource: null,
  iceConfig: { iceServers: [] },
  joined: false,
  localStream: null,
  muted: false,
  peers: new Map(),
  peerId: createPeerId(),
  roomId: getRoomId(),
  self: null
};

let toastTimer = null;
let meterFrame = 0;

init();

function init() {
  elements.roomTitle.textContent = state.roomId;
  elements.roomLink.value = window.location.href;
  elements.nameInput.value = localStorage.getItem('voice-room:name') || '';
  elements.joinForm.addEventListener('submit', joinRoom);
  elements.copyLinkButton.addEventListener('click', copyLink);
  elements.newRoomButton.addEventListener('click', openNewRoom);
  elements.muteButton.addEventListener('click', toggleMute);
  elements.leaveButton.addEventListener('click', leaveRoom);
  elements.soundButton.addEventListener('click', unlockAudio);
  elements.deviceSelect.addEventListener('change', switchMicrophone);
  window.addEventListener('beforeunload', leaveRoom);
  refreshParticipantState();
  refreshDevices().catch(() => {});
}

function getRoomId() {
  const match = window.location.pathname.match(/^\/r\/([A-Za-z0-9_-]{3,48})\/?$/);
  if (match) return match[1];

  const roomId = createRoomId();
  window.history.replaceState({}, '', `/r/${roomId}`);
  return roomId;
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

async function joinRoom(event) {
  event.preventDefault();
  if (state.joined) return;

  elements.joinButton.disabled = true;
  setStatus('connecting', 'соединение');

  try {
    state.iceConfig = await fetchJson('/config');
    state.localStream = await openMicrophone();
    await refreshDevices();

    const name = getDisplayName();
    localStorage.setItem('voice-room:name', name);
    state.self = createParticipant({
      id: state.peerId,
      isLocal: true,
      joinedAt: Date.now(),
      muted: false,
      name
    });
    attachMeter(state.self, state.localStream);

    state.eventSource = new EventSource(
      `/events?room=${encodeURIComponent(state.roomId)}&peer=${encodeURIComponent(state.peerId)}&name=${encodeURIComponent(name)}`
    );
    state.eventSource.onmessage = handleServerMessage;
    state.eventSource.onerror = () => {
      if (state.joined) setStatus('connecting', 'переподключение');
    };

    state.joined = true;
    elements.joinForm.hidden = true;
    elements.controls.hidden = false;
    startMeters();
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Не удалось подключиться');
    setStatus('error', 'ошибка');
    stopLocalStream();
  } finally {
    elements.joinButton.disabled = false;
  }
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
    setStatus('connected', 'в эфире');
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
  status.textContent = peerInfo.muted ? 'микрофон выключен' : 'подключение';
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
  elements.muteText.textContent = state.muted ? 'Микрофон выключен' : 'Микрофон включен';
  updateParticipant({
    id: state.peerId,
    muted: state.muted,
    name: getDisplayName()
  });
  postState().catch(() => {});
}

function leaveRoom() {
  if (!state.joined && !state.localStream) return;

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

  elements.controls.hidden = true;
  elements.joinForm.hidden = false;
  state.muted = false;
  elements.muteButton.setAttribute('aria-pressed', 'false');
  elements.muteText.textContent = 'Микрофон включен';
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
    peer.status.textContent = 'микрофон выключен';
    return;
  }

  const stateText = peer.pc?.connectionState || peer.pc?.iceConnectionState;
  if (!stateText || stateText === 'new') {
    peer.status.textContent = peer.isLocal ? 'локальный звук' : 'подключение';
  } else if (stateText === 'connected' || stateText === 'completed') {
    peer.status.textContent = 'в эфире';
  } else if (stateText === 'failed' || stateText === 'disconnected') {
    peer.status.textContent = 'переподключение';
  } else {
    peer.status.textContent = stateText;
  }
}

function refreshParticipantState() {
  elements.emptyRoom.hidden = elements.participants.children.length > 0;
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

async function copyLink() {
  const link = elements.roomLink.value;
  try {
    await navigator.clipboard.writeText(link);
  } catch (error) {
    elements.roomLink.select();
    document.execCommand('copy');
  }
  showToast('Ссылка скопирована');
}

function openNewRoom() {
  window.location.href = `/r/${createRoomId()}`;
}

function getDisplayName() {
  return elements.nameInput.value.trim().replace(/\s+/g, ' ').slice(0, 40) || 'Гость';
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
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.dataset.visible = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    elements.toast.dataset.visible = 'false';
  }, 2400);
}
