import { getRoomPreset } from '$lib/visual/tokens';
import { elements } from '../ui/dom';
import { state } from '../core/state';
import { showToast } from '../ui/toast';
import { checkRoomExists, postJson } from '../net/api';
import { postState } from './presence';
import { createRoomProof } from '../net/pow';
import { cleanDisplayName, errorMessage, getInitials, wait } from '../core/utils';
import { extractRoomId } from '../core/session';
import { getDisplayName, persistName, requireSavedName, updateNameStatuses } from '../ui/names';
import {
  resetConnectionStatus,
  setServerConnectionStatus,
  setVoiceConnectionStatus,
  refreshLocalNetworkIndicator
} from '../ui/status';
import { refreshCallControls } from '../ui/controls';
import { refreshScreenControls, stopLocalScreenStream } from '../services/screen-share-service';
import { closeScreenView, refreshScreenStage } from '../ui/screen-view';
import {
  createParticipant,
  refreshParticipantState,
  removeAudioElements,
  removeParticipantView,
  removePeer,
  syncPeers,
  updateParticipant,
  updatePeerStatus
} from './participants';
import {
  connectLiveKitRoom,
  disconnectLiveKitRoom,
  syncLiveKitParticipantById,
  syncLiveKitParticipants
} from '../services/livekit-service';
import { getLocalMicrophoneCapture, openLocalMicrophone, setLocalMicrophoneCapture, stopMicrophoneCapture } from '../services/microphone-service';
import { attachMeter, startMeters, stopMeters } from '../media/meters';
import { startPeerLatencyStats, startSpeakingStats, stopPeerLatencyStats, stopSpeakingStats } from './stats';
import { clearAllPeerJoinCues, clearPeerJoinCue, clearStreamViewerCues, playPeerCue, playPeerJoinCue } from '../media/cues';
import { cancelScreenSourcePicker } from '../ui/screen-source-picker';
import {
  clearGateSwitchTimer,
  closeDevicePopover,
  closeOutputPopover,
  refreshDevices,
  refreshMicrophoneLevelMeter
} from '../ui/devices';
import { GATE_THRESHOLD_MIN_DB } from '../core/config';
import type { ServerMessage } from '../core/types';

function hideScreens(): void {
  elements.startScreen.hidden = true;
  elements.roomScreen.hidden = true;
  elements.notFoundScreen.hidden = true;
}

export function showStartScreen(): void {
  document.body.dataset.screen = 'start';
  document.title = 'Voice Room';
  hideScreens();
  elements.brand.hidden = false;
  elements.topbarRoomHeading.hidden = true;
  elements.startScreen.hidden = false;
  elements.statusPill.hidden = true;
  updateNameStatuses();
}

export async function showRoomRoute(): Promise<void> {
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

function showRoomScreen(): void {
  document.body.dataset.screen = 'room';
  const heading = state.roomName || state.roomId;
  document.title = `${heading} · Voice Room`;
  elements.roomTitle.textContent = heading;
  elements.roomCodeText.textContent = state.roomId;
  const roomVisual = getRoomPreset({
    emoji: state.roomEmoji,
    roomColorKey: state.roomColorKey,
    roomIconKey: state.roomIconKey,
    roomPresetKey: state.roomPresetKey
  });
  elements.roomEmojiBadge.textContent = roomVisual.emoji;
  elements.roomEmojiBadge.style.background = roomVisual.background;
  elements.roomEmojiBadge.style.boxShadow = `0 0 0 1px ${roomVisual.ring}`;
  elements.roomEmojiBadge.hidden = false;
  elements.emptyRoomAvatar.textContent = getInitials(state.savedName);
  hideScreens();
  elements.brand.hidden = true;
  elements.topbarRoomHeading.hidden = false;
  elements.roomScreen.hidden = false;
  resetConnectionStatus();

  updateNameStatuses();
  refreshCallControls();
  refreshScreenControls();
  refreshScreenStage();
  refreshParticipantState();
  autoJoinRoom();
}

export function showRoomNotFound(): void {
  leaveRoom();
  document.body.dataset.screen = 'not-found';
  document.title = 'Комната не найдена · Voice Room';
  elements.missingRoomCode.textContent = state.roomId || getMissingRoomLabel();
  hideScreens();
  elements.brand.hidden = false;
  elements.topbarRoomHeading.hidden = true;
  elements.notFoundScreen.hidden = false;
  elements.statusPill.hidden = true;
}

function getMissingRoomLabel(): string {
  try {
    return decodeURIComponent(window.location.pathname).replace(/^\/r\/?/, '').replace(/\/$/, '') || 'room';
  } catch {
    return 'room';
  }
}

export async function createRoomFromStart(): Promise<void> {
  if (!requireSavedName(elements.startNameInput)) return;

  const previousLabel = elements.createRoomButton.textContent;
  elements.createRoomButton.disabled = true;
  elements.createRoomButton.textContent = 'Создаём...';
  try {
    const proof = await createRoomProof();
    const room = await postJson('/api/rooms', { proof });
    openRoom(room.roomId);
  } catch (error) {
    console.error(error);
    showToast(errorMessage(error) || 'Не удалось создать комнату');
  } finally {
    elements.createRoomButton.textContent = previousLabel;
    elements.createRoomButton.disabled = false;
  }
}

export function joinRoomByCode(): void {
  if (!requireSavedName(elements.startNameInput)) return;

  const roomId = extractRoomId(elements.roomCodeInput.value);
  if (!roomId) {
    showToast('Введите код комнаты');
    elements.roomCodeInput.focus();
    return;
  }

  openRoom(roomId);
}

export function handleRoomCodeKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  joinRoomByCode();
}

function openRoom(roomId: string): void {
  window.location.href = `/r/${encodeURIComponent(roomId)}`;
}

function ensureNameForRoomLink(): boolean {
  if (state.savedName) return true;

  const promptedName = cleanDisplayName(window.prompt('Как вас зовут?'));
  if (!promptedName) return false;

  persistName(promptedName);
  return true;
}

export async function joinRoom(event?: Event): Promise<void> {
  event?.preventDefault();
  if (state.joined || state.connecting) return;

  state.connecting = true;
  state.localConnectionQuality = 'unknown';
  state.localPingMs = null;
  resetConnectionStatus();
  refreshLocalNetworkIndicator();
  elements.muteButton.disabled = true;
  setServerConnectionStatus('connecting');
  setVoiceConnectionStatus('idle');
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
      `/api/events?room=${encodeURIComponent(state.roomId)}&peer=${encodeURIComponent(state.peerId)}&token=${encodeURIComponent(state.sessionToken)}&name=${encodeURIComponent(name)}`
    );
    state.eventSource.onopen = () => {
      setServerConnectionStatus('connected');
    };
    state.eventSource.onmessage = (event) => {
      handleServerMessage(event).catch((err) => {
        console.error('SSE handler failed', err);
      });
    };
    state.eventSource.onerror = () => {
      if (state.joined || state.connecting) setServerConnectionStatus('reconnecting');
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
    setVoiceConnectionStatus(isVoiceRouteError(error) ? 'no-route' : 'error');
    state.eventSource?.close();
    state.eventSource = null;
    state.serverPeerIds.clear();
    state.serverPeerSyncReady = false;
    await disconnectLiveKitRoom();
    removeParticipantView(state.self?.id || state.peerId);
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

function autoJoinRoom(): void {
  if (state.autoJoinStarted) return;
  state.autoJoinStarted = true;

  window.setTimeout(() => {
    if (!state.roomId || state.joined || state.connecting) return;

    joinRoom().catch((error) => {
      console.error(error);
      showToast('Не удалось подключиться');
      setVoiceConnectionStatus(isVoiceRouteError(error) ? 'no-route' : 'error');
    });
  }, 0);
}

function formatJoinError(error: unknown): string {
  const message = errorMessage(error);
  if (/signal connection|failed to fetch/i.test(message)) {
    return 'LiveKit недоступен: проверьте LIVEKIT_URL=ws://127.0.0.1:7880 и перезапустите VoiceRoom';
  }
  return message || 'Не удалось подключиться';
}

export function isVoiceRouteError(error: unknown): boolean {
  const message = errorMessage(error);
  return /ice|no route|signal connection|failed to fetch|timeout|websocket/i.test(message);
}

async function handleServerMessage(event: MessageEvent): Promise<void> {
  let message: ServerMessage;
  try {
    message = JSON.parse(event.data) as ServerMessage;
  } catch {
    return;
  }

  if (message.type === 'hello') {
    const peers = Array.isArray(message.peers) ? message.peers : [];
    state.serverPeerIds = new Set(peers.map((peer) => peer.id).filter(Boolean));
    state.serverPeerSyncReady = true;
    setServerConnectionStatus('connected');
    syncPeers([...state.serverPeerIds]);
    if (message.peer?.id) {
      updateParticipant({ ...message.peer, isLocal: true });
    }
    for (const peer of peers) {
      createParticipant(peer);
    }
    syncLiveKitParticipants(state.livekitRoom);
    refreshParticipantState();
    if (state.joined) postState().catch(() => {});
    return;
  }

  if (message.type === 'ping') {
    setServerConnectionStatus('connected');
    return;
  }

  if (message.type === 'room-not-found') {
    showRoomNotFound();
    return;
  }

  if (message.type === 'peer-joined') {
    if (message.peer?.id) state.serverPeerIds.add(message.peer.id);
    createParticipant(message.peer);
    syncLiveKitParticipantById(message.peer?.id);
    playPeerJoinCue(message.peer?.id);
    refreshParticipantState();
    return;
  }

  if (message.type === 'peer-left') {
    const hadPeer = state.peers.has(message.peerId);
    state.serverPeerIds.delete(message.peerId);
    removePeer(message.peerId);
    clearPeerJoinCue(message.peerId);
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
}

export function leaveRoom(): void {
  if (!state.joined && !state.localStream && !state.localScreenStream && !state.connecting) return;

  state.connecting = false;
  state.joined = false;
  state.audioUnlockPending = false;
  state.localConnectionQuality = 'unknown';
  state.localPingMs = null;
  refreshLocalNetworkIndicator();
  clearGateSwitchTimer();
  state.eventSource?.close();
  state.eventSource = null;
  state.serverPeerIds.clear();
  state.serverPeerSyncReady = false;
  disconnectLiveKitRoom().catch((error) => console.warn('LiveKit disconnect failed', error));
  if (state.screenSourceRequest) cancelScreenSourcePicker();
  closeScreenView();
  state.screenCollapsedPeerIds.clear();
  state.screenSubscribedPeerIds.clear();

  for (const peer of state.peers.values()) {
    removeAudioElements(peer);
    removeParticipantView(peer.id);
  }
  state.peers.clear();

  removeParticipantView(state.self?.id || state.peerId);
  state.self = null;
  stopLocalStream();
  stopLocalScreenStream();
  stopMeters();
  stopPeerLatencyStats();
  stopSpeakingStats();

  state.muted = false;
  clearAllPeerJoinCues();
  clearStreamViewerCues();
  refreshCallControls();
  refreshScreenControls();
  closeDevicePopover();
  closeOutputPopover();
  resetConnectionStatus();
  refreshParticipantState();
}

function stopLocalStream(): void {
  stopMicrophoneCapture(getLocalMicrophoneCapture());
  state.localStream = null;
  state.localRawStream = null;
  state.micProcessor = null;
  refreshMicrophoneLevelMeter(GATE_THRESHOLD_MIN_DB);
}

export async function handleLeaveButtonClick(): Promise<void> {
  if (state.joined || state.localStream || state.connecting) {
    playPeerCue('leave');
    await wait(180);
    leaveRoom();
  }

  window.location.href = '/';
}

export async function copyRoomCode(): Promise<void> {
  await copyText(state.roomId);
  showToast('Код комнаты скопирован');
}

export async function copyRoomLink(): Promise<void> {
  const roomUrl = new URL(`/r/${encodeURIComponent(state.roomId)}`, window.location.origin);
  await copyText(roomUrl.href);
  showToast('Ссылка на комнату скопирована');
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const clipboardFallbackInput = document.createElement('input');
    clipboardFallbackInput.value = text;
    document.body.append(clipboardFallbackInput);
    clipboardFallbackInput.select();
    document.execCommand('copy');
    clipboardFallbackInput.remove();
  }
}
