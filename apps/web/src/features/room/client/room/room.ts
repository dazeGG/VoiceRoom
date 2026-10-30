import { useSessionStore } from '@/features/auth/session.store';
import { usePageStore } from '@/stores/page.store';
import { useStartUiStore } from '../../start-ui.store';
import { useVoiceSessionStore } from '../../voice-session.store';
import { state } from '../core/room-runtime.store';
import { showToast } from '../ui/toast';
import { ApiError } from '@/api/client';
import { checkRoomExists } from '../net/api';
import { postState } from './presence';
import { UserFacingError, wait } from '../core/utils';
import { rotateStoredPeerSession } from '../core/session';
import { guestBrowserId } from '@/entities/room/guest-id';
import { getRoomShell, isRoomEmbedded } from '../core/embed';
import { useLeaveScreenStore } from '../../leave-screen.store';
import { CALL_FEEDBACK_MAX_DURATION_S } from '@voice-room/shared/contracts/feedback';
import { useCallFeedbackStore } from '@/features/call-feedback/call-feedback.store';
import { getDesktopBoundaryPolicy } from '@/platform/desktop-boundary';
import { getDisplayName, updateNameStatuses } from '../ui/names';
import { resetConnectionStatus, setServerConnectionStatus, setVoiceConnectionStatus } from '../ui/status';
import { resetPushToTalkState } from '../ui/controls';
import { stopLocalScreenStream } from '../services/screen-share-service';
import { stopLocalCamera } from '../services/camera-service';
import { closeScreenView, refreshScreenStage } from '../ui/screen-view';
import { createParticipant, removeAudioElements, updatePeerStatus } from './participants';
import { connectLiveKitRoom, disconnectLiveKitRoom, syncRemoteVideoVisibility } from '../services/livekit-service';
import { LiveKitTransportError } from '../services/livekit/transport';
import { loadLiveKitClient } from '../media/livekit-runtime';
import { onAppVisibilityChange } from '@/platform/app-visibility';
import {
  describeMicrophoneError,
  getLocalMicrophoneCapture,
  openLocalMicrophone,
  setLocalMicrophoneCapture,
  stopMicrophoneCapture
} from '../services/microphone-service';
import { attachMeter, startMeters, stopMeters } from '../media/meters';
import { startPeerLatencyStats, stopPeerLatencyStats } from './stats';
import { resetNetworkLevel } from './network-report';
import { relieveVideo } from '../services/video-relief';
import { clearAllPeerJoinCues, clearStreamViewerCues, playPeerCue } from '../media/cues';
import { cancelScreenSourcePicker } from '../ui/screen-source-picker';
import { syncDesktopGlobalHotkeys } from '../services/desktop-hotkey-service';
import { useParticipantContextUiStore } from '../../participant-context-ui.store';
import {
  clearGateSwitchTimer,
  closeDevicePopover,
  closeCameraPopover,
  closeOutputPopover,
  refreshDevices,
  refreshMicrophoneLevelMeter,
  relieveNoiseSuppression,
  watchLocalMicrophone
} from '../ui/devices';
import { startCpuPressureWatch, stopCpuPressureWatch } from '../services/cpu-pressure';
import { noteCpuPressure, startCallStrainWatch, stopCallStrainWatch } from './call-strain';
import {
  finishCallQuality,
  type CallQualitySummary,
  recordCpuPressure,
  recordCpuRelief,
  recordPeerCount,
  startCallQuality
} from './call-quality';
import { GATE_THRESHOLD_MIN_DB } from '../core/config';
import { getAppRealtime } from '@/api/realtime';
import {
  ensureAppRealtimeConnected,
  joinVoiceRoom,
  leaveVoiceRoom as sendVoiceLeave,
  subscribeRoomVoice
} from '@/entities/room/room-realtime';
import { resolveRoomEntryName } from './room-entry';
import { createVoiceEventHandler } from './voice-events';
import { markInAppRoomNavigation } from '@/platform/open-in-app';
import { isMicrophoneShownMuted } from '../core/microphone-mute';
import type { MicrophoneCapture } from '../core/types';
import {
  cancelRoomRecovery,
  notifyRoomAppConnection,
  notifyRoomNetworkOffline,
  notifyRoomNetworkOnline,
  notifyLiveKitReconciled,
  startRoomRecovery
} from '../recovery/room-recovery';

import { createLogger, errorContext } from '@/shared/log';

const log = createLogger('room');

let voiceJoinSent = false;
let stopVideoVisibilitySync: (() => void) | null = null;
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
  usePageStore().screen = 'start';
  document.title = 'VoiceRoom';
  updateNameStatuses();
}

export async function showRoomRoute(): Promise<boolean> {
  usePageStore().screen = 'checking';

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
  document.title = `${heading} · VoiceRoom`;
}

function showRoomScreen(): void {
  usePageStore().screen = 'room';
  refreshRoomHeading();
  resetConnectionStatus();

  updateNameStatuses();
  refreshScreenStage();
}

export function showRoomEntryFailure(): void {
  leaveRoom();
  usePageStore().screen = 'entry-error';
  document.title = 'Не удалось проверить вход · VoiceRoom';
}

export function showRoomNotFound(): void {
  leaveRoom();
  usePageStore().screen = 'not-found';
  document.title = 'Комната не найдена · VoiceRoom';
  useStartUiStore().missingRoomCode = state.roomId || getMissingRoomLabel();
}

function showRoomModerationScreen(reason: 'banned' | 'kicked'): void {
  leaveRoom();
  const nextSession = rotateStoredPeerSession(state.roomId);
  state.peerId = nextSession.peerId;
  state.sessionToken = nextSession.sessionToken;
  state.moderationReason = reason;
  usePageStore().screen = 'moderation';
  document.title = reason === 'banned' ? 'Доступ к комнате закрыт · VoiceRoom' : 'Вы исключены · VoiceRoom';
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

    // The library downloads while the microphone opens (a permission prompt can
    // take a while), not after the token. A failure here is retried at connect.
    loadLiveKitClient().catch(() => {});
    const microphoneCapture = await openJoinMicrophone();
    if (!isCurrent()) {
      if (microphoneCapture) stopMicrophoneCapture(microphoneCapture);
      return;
    }
    if (microphoneCapture) {
      setLocalMicrophoneCapture(microphoneCapture);
      watchLocalMicrophone();
    } else {
      state.microphoneMissing = true;
    }
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
      avatarAccent: useSessionStore().user?.avatarAccent || '',
      avatarColorKey: useSessionStore().user?.avatarColorKey || '',
      avatarUrl: useSessionStore().user?.avatarUrl || ''
    });
    attachMeter(state.self, state.localStream);
    updatePeerStatus(state.self);

    ensureAppRealtimeConnected();
    state.voiceRealtimeTeardown?.();
    const detachVoiceEvents = subscribeRoomVoice(state.roomId, (event) => {
      handleVoiceEvent(event).catch((err: unknown) => {
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
    useVoiceSessionStore().setConnectedVoiceRoom(state.roomId);
    void syncDesktopGlobalHotkeys(true);
    useVoiceSessionStore().setVoiceSessionTiming({ joinedAt: state.self?.joinedAt ?? Date.now() });
    useVoiceSessionStore().setVoiceControlsState({ muted: isMicrophoneShownMuted(), deafened: state.outputMuted });
    if (isMicrophoneShownMuted() || state.outputMuted) postState().catch(() => {});
    startMeters();
    startPeerLatencyStats();
    // Remote video pauses while the app cannot be seen (tray, minimized, background tab).
    stopVideoVisibilitySync?.();
    stopVideoVisibilitySync = onAppVisibilityChange(() => syncRemoteVideoVisibility());
    syncRemoteVideoVisibility();
    // A question still open about an earlier call would now be about this one.
    useCallFeedbackStore().dropCallFeedback();
    startCallQuality();
    resetNetworkLevel();
    recordPeerCount(state.peers.size);
    // Relief comes from the call showing strain (call-strain.ts), not from a busy system alone.
    startCallStrainWatch(() => {
      // The noise suppression and, silently, the video (video-relief.ts).
      void relieveNoiseSuppression().then((switched) => {
        if (switched) recordCpuRelief();
      });
      void relieveVideo().then(() => recordCpuRelief());
    });
    startCpuPressureWatch({
      onState: (pressure) => {
        recordCpuPressure(pressure);
        noteCpuPressure(pressure);
      }
    });
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
    setVoiceConnectionStatus(error instanceof LiveKitTransportError ? 'no-route' : 'error');
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
  }
}

/**
 * A missing or refused microphone does not keep anyone out of the call: they
 * join to listen, and the microphone button or a plugged-in device adds it.
 */
async function openJoinMicrophone(): Promise<MicrophoneCapture | null> {
  try {
    return await openLocalMicrophone();
  } catch (error) {
    log.warn('joining without a microphone', errorContext(error));
    showToast(`${describeMicrophoneError(error)}: вы в комнате без микрофона`, { duration: 8000 });
    return null;
  }
}

function formatJoinError(error: unknown): string {
  if (error instanceof LiveKitTransportError) {
    return 'LiveKit недоступен: голосовой сервер не отвечает, попробуйте подключиться позже';
  }
  if (error instanceof ApiError || error instanceof UserFacingError) return error.message;
  return 'Не удалось подключиться';
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
  disconnectLiveKitRoom().catch((error: unknown) => log.warn('liveKit disconnect failed', errorContext(error)));
  if (state.screenSourceRequest) cancelScreenSourcePicker();
  closeScreenView();
  useParticipantContextUiStore().closeParticipantContextMenu();
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
  stopVideoVisibilitySync?.();
  stopVideoVisibilitySync = null;
  stopCpuPressureWatch();
  stopCallStrainWatch();
  noteFinishedCall(disconnectedRoomId, finishCallQuality());

  state.muted = false;
  state.microphoneMissing = false;
  state.videoRelieved = false;
  resetPushToTalkState();
  clearAllPeerJoinCues();
  clearStreamViewerCues();
  closeDevicePopover();
  closeOutputPopover();
  closeCameraPopover();
  resetConnectionStatus();
  useVoiceSessionStore().clearConnectedVoiceRoom(disconnectedRoomId);
}

// What "how was the call?" sends along with an answer, should the leave ask it.
function noteFinishedCall(roomId: string, summary: CallQualitySummary | null): void {
  if (!roomId || !summary) {
    useCallFeedbackStore().noteCallFinished(null);
    return;
  }
  const { stats } = summary;
  const desktopApp = Boolean(window.voiceRoomRuntime?.isDesktop);
  useCallFeedbackStore().noteCallFinished({
    roomId,
    durationS: Math.min(stats.durationS, CALL_FEEDBACK_MAX_DURATION_S),
    peers: stats.peersMax,
    platform: desktopApp ? 'desktop_app' : getDesktopBoundaryPolicy().desktopAllowed ? 'browser' : 'mobile',
    quality: {
      rttAvgMs: stats.rttAvgMs,
      inboundLossAvgPct: stats.inboundLossAvgPct,
      outboundLossAvgPct: stats.outboundLossAvgPct,
      jitterAvgMs: stats.jitterAvgMs,
      reconnects: stats.reconnects,
      transport: stats.transport,
      rttMaxMs: stats.rttMaxMs,
      inboundLossMaxPct: stats.inboundLossMaxPct,
      outboundLossMaxPct: stats.outboundLossMaxPct,
      jitterMaxMs: stats.jitterMaxMs,
      cpuPressureMax: stats.cpuPressureMax,
      cpuRelieved: stats.cpuRelieved,
      micDrops: stats.micDrops,
      inboundPackets: stats.inboundPackets,
      inboundLostPackets: stats.inboundLostPackets,
      outboundPackets: stats.outboundPackets,
      outboundLostPackets: stats.outboundLostPackets,
      concealedAvgPct: stats.concealedAvgPct,
      concealedMaxPct: stats.concealedMaxPct,
      appCpuAvgPct: stats.appCpuAvgPct,
      appCpuMaxPct: stats.appCpuMaxPct,
      systemCpuAvgPct: stats.systemCpuAvgPct
    },
    ...(useSessionStore().user ? {} : { guestId: guestBrowserId() })
  });
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
  const guest = !isRoomEmbedded() && !useSessionStore().user;
  // `/` is desktop-only, so leaving on a phone stays on the room page.
  const mobile = !getDesktopBoundaryPolicy().desktopAllowed;
  if (state.joined || state.localStream || state.connecting) {
    playPeerCue('leave');
    await wait(180);
    leaveRoom();
    useCallFeedbackStore().offerCallFeedback();
  }

  if (isRoomEmbedded()) {
    getRoomShell().roomLeft(roomId);
    return;
  }

  if ((guest || mobile) && roomId) {
    useLeaveScreenStore().openLeaveScreen({ roomId, isStatic: state.roomIsStatic, guest });
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
