import { session } from '$lib/features/auth/session.svelte';
import { startUi } from '../../start-ui.svelte';
import {
  clearConnectedVoiceRoom,
  setConnectedVoiceRoom,
  setVoiceControlsState,
  setVoiceSessionTiming
} from '../../voice-session.svelte';
import { state } from '../core/state.svelte';
import { showToast } from '../ui/toast';
import { ApiError } from '$lib/api/client';
import { checkRoomExists } from '../net/api';
import { postState } from './presence';
import { errorMessage, wait } from '../core/utils';
import { rotateStoredPeerSession } from '../core/session';
import { isRoomEmbedded } from '../core/embed';
import { openLeaveScreen } from '../../leave-screen.svelte';
import { getDesktopBoundaryPolicy } from '$lib/platform/desktop-boundary';
import { getDisplayName, updateNameStatuses } from '../ui/names';
import { resetConnectionStatus, setServerConnectionStatus, setVoiceConnectionStatus } from '../ui/status';
import { refreshCallControls, resetPushToTalkState } from '../ui/controls';
import { refreshScreenControls, stopLocalScreenStream } from '../services/screen-share-service';
import { stopLocalCamera } from '../services/camera-service';
import { closeScreenView, refreshScreenStage } from '../ui/screen-view';
import { createParticipant, removeAudioElements, updatePeerStatus } from './participants';
import { connectLiveKitRoom, disconnectLiveKitRoom } from '../services/livekit-service';
import {
  getLocalMicrophoneCapture,
  openLocalMicrophone,
  setLocalMicrophoneCapture,
  stopMicrophoneCapture
} from '../services/microphone-service';
import { attachMeter, startMeters, stopMeters } from '../media/meters';
import { startPeerLatencyStats, startSpeakingStats, stopPeerLatencyStats, stopSpeakingStats } from './stats';
import { clearAllPeerJoinCues, clearStreamViewerCues, playPeerCue } from '../media/cues';
import { cancelScreenSourcePicker } from '../ui/screen-source-picker';
import { syncDesktopGlobalHotkeys } from '../services/desktop-hotkey-service';
import { closeParticipantContextMenu } from '../../participant-context-ui.svelte';
import {
  clearGateSwitchTimer,
  closeDevicePopover,
  closeCameraPopover,
  closeOutputPopover,
  refreshDevices,
  refreshMicrophoneLevelMeter
} from '../ui/devices';
import { GATE_THRESHOLD_MIN_DB } from '../core/config';
import { getAppRealtime } from '$lib/api/realtime';
import {
  ensureAppRealtimeConnected,
  joinVoiceRoom,
  leaveVoiceRoom as sendVoiceLeave,
  subscribeRoomVoice
} from '$lib/entities/room/room-realtime';
import { resolveRoomEntryName } from './room-entry';
import { createVoiceEventHandler } from './voice-events';
import { markInAppRoomNavigation } from '$lib/platform/open-in-app';
import { isMicrophoneShownMuted } from '../core/microphone-mute';
import {
  cancelRoomRecovery,
  notifyRoomAppConnection,
  notifyRoomNetworkOffline,
  notifyRoomNetworkOnline,
  notifyLiveKitReconciled,
  startRoomRecovery
} from '../recovery/room-recovery';

import { createLogger, errorContext } from '$lib/shared/log';

const log = createLogger('room');

let voiceJoinSent = false;
let joinAttemptGeneration = 0;
let activeJoinAttempt: Promise<void> | null = null;

const handleVoiceEvent = createVoiceEventHandler({
  leaveRoom: () => leaveRoom(),
  showModeration: (reason) => showRoomModerationScreen(reason),
  showNotFound: () => showRoomNotFound()
});

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
    return (
      decodeURIComponent(window.location.pathname)
        .replace(/^\/r\/?/, '')
        .replace(/\/$/, '') || 'room'
    );
  } catch {
    return 'room';
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
  state.localNetwork = { inboundLossPct: null, jitterMs: null, outboundLossPct: null, transport: null };
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
      muted: isMicrophoneShownMuted(),
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
      handleVoiceEvent(event).catch((err) => {
        log.error('voice realtime handler failed', errorContext(err));
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
    setVoiceControlsState({ muted: isMicrophoneShownMuted(), deafened: state.outputMuted });
    if (isMicrophoneShownMuted() || state.outputMuted) postState().catch(() => {});
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
    log.error('room action failed', errorContext(error));
    const banned = error instanceof ApiError && error.code === 'room_banned';
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

function isVoiceRouteError(error: unknown): boolean {
  const message = errorMessage(error);
  return /ice|no route|signal connection|failed to fetch|timeout|websocket/i.test(message);
}

export function leaveRoom(): void {
  joinAttemptGeneration += 1;
  cancelRoomRecovery();
  void syncDesktopGlobalHotkeys(false);
  if (
    !state.joined &&
    !state.localStream &&
    !state.localScreenStream &&
    !state.connecting &&
    !voiceJoinSent &&
    !state.voiceRealtimeTeardown
  )
    return;

  const disconnectedRoomId = state.roomId;
  state.connecting = false;
  state.joined = false;
  state.audioUnlockPending = false;
  state.localConnectionQuality = 'unknown';
  state.localPingMs = null;
  state.localNetwork = { inboundLossPct: null, jitterMs: null, outboundLossPct: null, transport: null };
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
  disconnectLiveKitRoom().catch((error) => log.warn('liveKit disconnect failed', errorContext(error)));
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
  stopLocalCamera();
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
  closeCameraPopover();
  resetConnectionStatus();
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
  // Read before leaving: leaveRoom forgets who was in the call.
  const roomId = state.roomId;
  const guest = !isRoomEmbedded() && !session.user;
  // `/` is desktop-only, so leaving on a phone stays on the room page.
  const mobile = !getDesktopBoundaryPolicy().desktopAllowed;
  if (state.joined || state.localStream || state.connecting) {
    playPeerCue('leave');
    await wait(180);
    leaveRoom();
  }

  if (isRoomEmbedded()) {
    window.dispatchEvent(new CustomEvent('voice-room:embedded-leave', { detail: { roomId } }));
    return;
  }

  if ((guest || mobile) && roomId) {
    openLeaveScreen({ roomId, isStatic: state.roomIsStatic, guest });
    return;
  }

  window.location.href = '/';
}

/**
 * A guest who just created an account comes back to the same room as that
 * account. The session is not swapped in place: that would unmount this call
 * mid-flight and let the lobby offer the desktop app again. Instead the call is
 * left cleanly and the room page reloads signed in, with the in-app mark set so
 * the reload joins in the browser.
 */
export async function rejoinRoomSignedIn(roomId: string): Promise<void> {
  markInAppRoomNavigation();
  try {
    if (state.joined || state.localStream || state.connecting) {
      playPeerCue('leave');
      await wait(180);
      leaveRoom();
    }
  } catch (error) {
    log.error('guest register rejoin failed', errorContext(error));
  }
  window.location.assign(`/r/${encodeURIComponent(roomId)}`);
}
