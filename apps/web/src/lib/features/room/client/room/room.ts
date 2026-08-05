import { addRoomByCode, fetchMe, fetchOwnedRooms } from '$lib/api/auth';
import { session, setUser } from '$lib/features/auth/session.svelte';
import { roomNameFor } from '$lib/features/auth/account';
import { roomSettingsUi } from '../../room-settings.svelte';
import { startUi } from '../../start-ui.svelte';
import { clearConnectedVoiceRoom, setConnectedVoiceRoom, setVoiceControlsState, setVoiceSessionTiming } from '../../voice-session.svelte';
import { state } from '../core/state.svelte';
import { showToast } from '../ui/toast';
import { ApiRequestError, checkRoomExists, postJson } from '../net/api';
import { postState } from './presence';
import { createRoomProof } from '../net/pow';
import { errorMessage, wait } from '../core/utils';
import { extractRoomId, rotateStoredPeerSession } from '../core/session';
import { isRoomEmbedded } from '../core/embed';
import { getDisplayName, persistName, requestGuestNameForRoom, requireSavedName, updateNameStatuses } from '../ui/names';
import {
  resetConnectionStatus,
  setServerConnectionStatus,
  setVoiceConnectionStatus
} from '../ui/status';
import { refreshCallControls, resetPushToTalkState } from '../ui/controls';
import { refreshScreenControls, stopLocalScreenStream } from '../services/screen-share-service';
import { closeScreenView, refreshScreenStage } from '../ui/screen-view';
import {
  createParticipant,
  refreshParticipantState,
  removeAudioElements,
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
import { syncDesktopGlobalHotkeys } from '../services/desktop-hotkey-service';
import { closeParticipantContextMenu } from '../../participant-context-ui.svelte';
import {
  clearGateSwitchTimer,
  closeDevicePopover,
  closeOutputPopover,
  refreshDevices,
  refreshMicrophoneLevelMeter
} from '../ui/devices';
import { GATE_THRESHOLD_MIN_DB } from '../core/config';
import { getAppRealtime, type RealtimeEvent } from '$lib/api/realtime';
import {
  ensureAppRealtimeConnected,
  joinVoiceRoom,
  leaveVoiceRoom as sendVoiceLeave,
  subscribeRoomVoice
} from '$lib/features/home/model/room-realtime';
import { applyRoomDeleted, applyRoomUpdated } from './lifecycle';
import {
  cancelRoomRecovery,
  notifyRoomAppConnection,
  notifyRoomNetworkOffline,
  notifyRoomNetworkOnline,
  notifyRoomSnapshotApplied,
  notifyLiveKitReconciled,
  startRoomRecovery
} from '../recovery/room-recovery';

type RoomEntryGateResult = 'authenticated' | 'anonymous' | 'failure';

let voiceJoinSent = false;
let joinAttemptGeneration = 0;
let activeJoinAttempt: Promise<void> | null = null;

function isCurrentJoinAttempt(generation: number): boolean {
  return generation === joinAttemptGeneration;
}

export function showStartScreen(): void {
  document.body.dataset.screen = 'start';
  state.screen = 'start';
  document.title = 'Voice Room';
  updateNameStatuses();
}

export async function showRoomRoute(): Promise<boolean> {
  document.body.dataset.screen = 'checking';
  state.screen = 'checking';

  const exists = await checkRoomExists(state.roomId);
  if (!exists) {
    showRoomNotFound();
    return false;
  }

  const entryGate = await resolveRoomEntryName();
  if (entryGate === 'failure') {
    showRoomEntryFailure();
    return false;
  }

  showRoomScreen();
  refreshDevices().catch(() => {});
  return true;
}

// The room heading (title and code) is rendered reactively by
// RoomTopbar.svelte from the room state. Only the document title — a side effect
// outside the component tree — stays here; it runs on screen entry and rename.
export function refreshRoomHeading(): void {
  const heading = state.roomName || state.roomId;
  document.title = `${heading} · Voice Room`;
}

function showRoomScreen(): void {
  document.body.dataset.screen = 'room';
  state.screen = 'room';
  refreshRoomHeading();
  resetConnectionStatus();

  updateNameStatuses();
  refreshCallControls();
  refreshScreenControls();
  refreshScreenStage();
  refreshParticipantState();
}

export function showRoomEntryFailure(): void {
  leaveRoom();
  document.body.dataset.screen = 'entry-error';
  state.screen = 'entry-error';
  document.title = 'Не удалось проверить вход · Voice Room';
}

export function showRoomNotFound(): void {
  leaveRoom();
  document.body.dataset.screen = 'not-found';
  state.screen = 'not-found';
  document.title = 'Комната не найдена · Voice Room';
  startUi.missingRoomCode = state.roomId || getMissingRoomLabel();
}

function showRoomModerationScreen(reason: 'banned' | 'kicked'): void {
  leaveRoom();
  const nextSession = rotateStoredPeerSession(state.roomId);
  state.peerId = nextSession.peerId;
  state.sessionToken = nextSession.sessionToken;
  state.moderationReason = reason;
  document.body.dataset.screen = 'moderation';
  state.screen = 'moderation';
  document.title = reason === 'banned' ? 'Доступ к комнате закрыт · Voice Room' : 'Вы исключены · Voice Room';
}

function getMissingRoomLabel(): string {
  try {
    return decodeURIComponent(window.location.pathname).replace(/^\/r\/?/, '').replace(/\/$/, '') || 'room';
  } catch {
    return 'room';
  }
}

export async function createRoomFromStart(): Promise<void> {
  if (!requireSavedName(startUi.nameInput)) return;

  startUi.createRoomLoading = true;
  try {
    const proof = await createRoomProof();
    const room = await postJson('/api/rooms', { proof });
    openRoom(room.roomId);
  } catch (error) {
    console.error(error);
    showToast(errorMessage(error) || 'Не удалось создать комнату');
  } finally {
    startUi.createRoomLoading = false;
  }
}

export function joinRoomByCode(): void {
  if (!requireSavedName(startUi.nameInput)) return;

  const roomId = extractRoomId(startUi.roomCode);
  if (!roomId) {
    showToast('Введите код комнаты');
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

async function autoSaveRoomForAuthenticatedUser(roomId: string): Promise<void> {
  if (!roomId) return;
  try {
    await addRoomByCode(roomId);
    window.dispatchEvent(new CustomEvent('voice-room:rooms-changed', { detail: { roomId } }));
  } catch (error) {
    // Auto-save is a convenience side effect: temporary rooms, already-pruned
    // rooms, and transient bookmark failures must never block or noisy-toast
    // the room entry flow.
    console.debug('Room auto-save skipped', error);
  }
}

async function resolveRoomEntryName(): Promise<RoomEntryGateResult> {
  // Room links intentionally verify the account directly instead of using the
  // home session loader: this route has no lobby session UI, and an auth-check
  // failure must stop entry instead of silently treating the user as anonymous.
  try {
    const user = await fetchMe();
    if (user) {
      setUser(user);
      persistName(roomNameFor(user));
      void autoSaveRoomForAuthenticatedUser(state.roomId);
      // Settings/delete UI is owner-only; the lobby's room list is the only
      // place "owner" is known client-side, so cross-check it here.
      try {
        const owned = await fetchOwnedRooms();
        roomSettingsUi.isOwner = owned.some((room) => room.roomId === state.roomId && room.relationship === 'owner');
      } catch (ownedError) {
        console.warn('Failed to resolve room ownership', ownedError);
      }
      return 'authenticated';
    }
  } catch (error) {
    console.error('Failed to check room entry session', error);
    showToast('Не удалось проверить аккаунт. Попробуйте обновить страницу.');
    return 'failure';
  }

  try {
    await requestGuestNameForRoom();
    return 'anonymous';
  } catch (error) {
    console.warn('Guest name request cancelled', error);
    return 'failure';
  }
}

export async function joinRoom(event?: Event): Promise<void> {
  event?.preventDefault();
  if (state.joined || state.connecting) return;

  const generation = ++joinAttemptGeneration;
  const attempt = performJoinRoom(generation);
  activeJoinAttempt = attempt;
  try {
    await attempt;
  } finally {
    if (activeJoinAttempt === attempt) activeJoinAttempt = null;
  }
}

async function performJoinRoom(generation: number): Promise<void> {
  const isCurrent = (): boolean => isCurrentJoinAttempt(generation);

  state.connecting = true;
  state.localConnectionQuality = 'unknown';
  state.localPingMs = null;
  resetConnectionStatus();
  setServerConnectionStatus('connecting');
  setVoiceConnectionStatus('idle');
  refreshCallControls();

  try {
    const exists = await checkRoomExists(state.roomId);
    if (!isCurrent()) return;
    if (!exists) {
      showRoomNotFound();
      return;
    }

    if (state.outputMuted) {
      state.micMutedBeforeOutputMute = state.muted;
      state.muted = true;
    }
    if (state.microphoneMode === 'push-to-talk') state.muted = true;

    const microphoneCapture = await openLocalMicrophone();
    if (!isCurrent()) {
      stopMicrophoneCapture(microphoneCapture);
      return;
    }
    setLocalMicrophoneCapture(microphoneCapture);
    await refreshDevices();
    if (!isCurrent()) return;

    const name = getDisplayName();
    state.self = createParticipant({
      id: state.peerId,
      deafened: state.outputMuted,
      isLocal: true,
      joinedAt: Date.now(),
      muted: state.muted,
      name,
      avatarAccent: session.user?.avatarAccent || '',
      avatarColorKey: session.user?.avatarColorKey || '',
      avatarUrl: session.user?.avatarUrl || ''
    });
    attachMeter(state.self, state.localStream);
    updatePeerStatus(state.self);

    ensureAppRealtimeConnected();
    state.voiceRealtimeTeardown?.();
    const detachVoiceEvents = subscribeRoomVoice(state.roomId, (event) => {
      handleVoiceRealtimeEvent(event).catch((err) => {
        console.error('Voice realtime handler failed', err);
      });
    });
    const realtime = getAppRealtime();
    startRoomRecovery(realtime.getConnectionEpoch(), realtime.isConnected());
    // Surface WS drops in the status pill; the snapshot that follows the
    // automatic re-join flips it back to 'connected'.
    const detachConnState = realtime.onStateChange((connected, appEpoch) => {
      setServerConnectionStatus(connected ? 'connecting' : 'reconnecting');
      notifyRoomAppConnection(connected, appEpoch);
    });
    const handleOffline = () => notifyRoomNetworkOffline();
    const handleOnline = () => notifyRoomNetworkOnline();
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    state.voiceRealtimeTeardown = () => {
      cancelRoomRecovery();
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      detachConnState();
      detachVoiceEvents();
    };
    joinVoiceRoom({
      roomId: state.roomId,
      peerId: state.peerId,
      sessionToken: state.sessionToken,
      name
    });
    voiceJoinSent = true;
    setServerConnectionStatus('connecting');

    const connected = await connectLiveKitRoom(name, isCurrent);
    if (!connected || !isCurrent()) return;
    notifyLiveKitReconciled();
    state.joined = true;
    setConnectedVoiceRoom(state.roomId);
    void syncDesktopGlobalHotkeys(true);
    setVoiceSessionTiming({ joinedAt: state.self?.joinedAt ?? Date.now() });
    setVoiceControlsState({ muted: state.muted, deafened: state.outputMuted });
    if (state.muted || state.outputMuted) postState().catch(() => {});
    refreshCallControls();
    refreshScreenControls();
    startMeters();
    startPeerLatencyStats();
    startSpeakingStats();
    playPeerCue('join');
  } catch (error) {
    if (!isCurrent()) {
      // leaveRoom already cleaned this attempt's published state. Async capture,
      // token and LiveKit work self-disposes through the generation predicate.
      return;
    }
    console.error(error);
    const banned = error instanceof ApiRequestError && error.code === 'room_banned';
    if (!banned) showToast(formatJoinError(error));
    setVoiceConnectionStatus(isVoiceRouteError(error) ? 'no-route' : 'error');
    if (voiceJoinSent && state.roomId && state.peerId && state.sessionToken) {
      sendVoiceLeave({ roomId: state.roomId, peerId: state.peerId, sessionToken: state.sessionToken });
      voiceJoinSent = false;
    }
    state.voiceRealtimeTeardown?.();
    state.voiceRealtimeTeardown = null;
    state.serverPeerIds.clear();
    state.serverPeerSyncReady = false;
    await disconnectLiveKitRoom();
    state.self = null;
    stopLocalStream();
    refreshParticipantState();
    if (banned) showRoomModerationScreen('banned');
  } finally {
    if (isCurrent()) state.connecting = false;
    refreshCallControls();
    refreshScreenControls();
  }
}

function formatJoinError(error: unknown): string {
  const message = errorMessage(error);
  if (/signal connection|failed to fetch/i.test(message)) {
    return 'LiveKit недоступен: проверьте LIVEKIT_GATE_PUBLIC_URL и перезапустите VoiceRoom';
  }
  return message || 'Не удалось подключиться';
}

export function isVoiceRouteError(error: unknown): boolean {
  const message = errorMessage(error);
  return /ice|no route|signal connection|failed to fetch|timeout|websocket/i.test(message);
}

async function handleVoiceRealtimeEvent(event: RealtimeEvent): Promise<void> {
  if (event.type === 'pong') {
    setServerConnectionStatus('connected');
    return;
  }

  if (event.type === 'room.snapshot') {
    const snapshot = event.payload;
    if (snapshot.roomId !== state.roomId) return;
    const peers = Array.isArray(snapshot.peers) ? snapshot.peers : [];
    const localPeer = peers.find((peer) => peer.id === state.peerId);
    const remotePeers = peers.filter((peer) => peer.id !== state.peerId);
    state.serverPeerIds = new Set(remotePeers.map((peer) => peer.id).filter(Boolean));
    state.serverPeerSyncReady = true;
    // Prefer the server clock for the call widget timers: my joinedAt from the
    // authoritative peer record, the shared call start from the room snapshot.
    setVoiceSessionTiming({
      joinedAt: localPeer?.joinedAt ?? state.self?.joinedAt ?? null,
      roomActiveSince: snapshot.voiceActiveSince ?? null
    });
    setServerConnectionStatus('connected');
    syncPeers([...state.serverPeerIds]);
    if (localPeer) {
      // Local controls and stream attendance are owned by this client; the snapshot
      // may carry a stale server copy (e.g. changed while reconnecting), so keep them.
      updateParticipant({
        ...localPeer,
        deafened: state.outputMuted,
        isLocal: true,
        muted: state.muted,
        viewedScreenPeerId: state.self?.viewedScreenPeerId ?? localPeer.viewedScreenPeerId
      });
    }
    for (const peer of remotePeers) {
      createParticipant(peer);
    }
    syncLiveKitParticipants(state.livekitRoom);
    refreshParticipantState();
    notifyRoomSnapshotApplied({
      appEpoch: getAppRealtime().getConnectionEpoch(),
      active: snapshot.mode === 'active',
      hasLocalPeer: Boolean(localPeer)
    });
    if (state.joined) postState().catch(() => {});
    return;
  }

  if (event.type === 'error') {
    if (event.payload.code === 'room_banned') {
      showRoomModerationScreen('banned');
      return;
    }
    showToast(event.payload.message || 'Ошибка realtime-соединения');
    if (event.payload.code === 'invalid_session' || event.payload.code === 'join_failed' || event.payload.code === 'room_full') {
      leaveRoom();
      setVoiceConnectionStatus('error');
    }
    return;
  }

  if (event.type === 'room.not_found') {
    showRoomNotFound();
    return;
  }


  if (event.type === 'room.kicked' || event.type === 'room.banned') {
    if (event.payload.roomId === state.roomId && (!event.payload.peerId || event.payload.peerId === state.peerId)) {
      showRoomModerationScreen(event.type === 'room.banned' ? 'banned' : 'kicked');
    }
    return;
  }

  if (event.type === 'room.peer.joined') {
    if (event.payload.peer?.id) state.serverPeerIds.add(event.payload.peer.id);
    createParticipant(event.payload.peer);
    syncLiveKitParticipantById(event.payload.peer?.id);
    playPeerJoinCue(event.payload.peer?.id);
    refreshParticipantState();
    return;
  }

  if (event.type === 'room.peer.left') {
    const hadPeer = state.peers.has(event.payload.peerId);
    state.serverPeerIds.delete(event.payload.peerId);
    removePeer(event.payload.peerId);
    clearPeerJoinCue(event.payload.peerId);
    if (hadPeer) playPeerCue('leave');
    refreshParticipantState();
    return;
  }

  if (event.type === 'room.peer.updated') {
    updateParticipant(event.payload.peer);
    return;
  }

  if (event.type === 'room.full') {
    showToast(`Комната заполнена: максимум ${event.payload.maxRoomPeers}`);
    leaveRoom();
    return;
  }

  if (event.type === 'room.updated') {
    applyRoomUpdated(event.payload.room);
    return;
  }

  if (event.type === 'room.deleted') {
    applyRoomDeleted(event.payload.roomId);
    return;
  }
}

export function leaveRoom(): void {
  joinAttemptGeneration += 1;
  cancelRoomRecovery();
  void syncDesktopGlobalHotkeys(false);
  if (!state.joined && !state.localStream && !state.localScreenStream && !state.connecting && !voiceJoinSent && !state.voiceRealtimeTeardown) return;

  const disconnectedRoomId = state.roomId;
  state.connecting = false;
  state.joined = false;
  state.audioUnlockPending = false;
  state.localConnectionQuality = 'unknown';
  state.localPingMs = null;
  clearGateSwitchTimer();
  if (state.roomId && state.peerId && state.sessionToken) {
    sendVoiceLeave({
      roomId: state.roomId,
      peerId: state.peerId,
      sessionToken: state.sessionToken
    });
    voiceJoinSent = false;
  }
  state.voiceRealtimeTeardown?.();
  state.voiceRealtimeTeardown = null;
  state.serverPeerIds.clear();
  state.serverPeerSyncReady = false;
  disconnectLiveKitRoom().catch((error) => console.warn('LiveKit disconnect failed', error));
  if (state.screenSourceRequest) cancelScreenSourcePicker();
  closeScreenView();
  closeParticipantContextMenu();
  state.screenCollapsedPeerIds.clear();
  state.screenSubscribedPeerIds.clear();

  for (const peer of state.peers.values()) {
    removeAudioElements(peer);
  }
  state.peers.clear();

  state.self = null;
  stopLocalStream();
  stopLocalScreenStream();
  stopMeters();
  stopPeerLatencyStats();
  stopSpeakingStats();

  state.muted = false;
  resetPushToTalkState();
  clearAllPeerJoinCues();
  clearStreamViewerCues();
  refreshCallControls();
  refreshScreenControls();
  closeDevicePopover();
  closeOutputPopover();
  resetConnectionStatus();
  refreshParticipantState();
  clearConnectedVoiceRoom(disconnectedRoomId);
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

  if (isRoomEmbedded()) {
    window.dispatchEvent(new CustomEvent('voice-room:embedded-leave', { detail: { roomId: state.roomId } }));
    return;
  }

  window.location.href = '/';
}

export async function copyRoomCode(): Promise<void> {
  if (await copyText(state.roomId)) {
    showToast('Код комнаты скопирован');
  } else {
    showToast(`Не удалось скопировать. Код: ${state.roomId}`);
  }
}

export async function copyRoomLink(): Promise<void> {
  const roomUrl = new URL(`/r/${encodeURIComponent(state.roomId)}`, window.location.origin);
  if (await copyText(roomUrl.href)) {
    showToast('Ссылка на комнату скопирована');
  } else {
    showToast(`Не удалось скопировать. Ссылка: ${roomUrl.href}`);
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
