import { callPageState } from '../core/call-page.store';
import { getCallPorts, getInstalledCallPorts } from '../ports';
import { t } from '@voiceroom/ui-kit/i18n';
import { useStartUiStore } from '../core/start-ui.store';
import { useVoiceSessionStore } from '../core/voice-session.store';
import { state } from '../core/room-runtime.store';
import { showToast } from '../ui/toast';
import { checkRoomExists, roomCheckIsFresh } from '../net/api';
import { finishJoinTiming, lastJoinStage, markJoinStage, startJoinTiming } from './join-timing';
import { postState } from './presence';
import { wait } from '../core/utils';
import { getRoomShell, isRoomEmbedded } from '../core/embed';
import { CALL_FEEDBACK_MAX_DURATION_S } from '@voiceroom/shared/contracts/feedback';
import { getDisplayName, updateNameStatuses } from '../ui/names';
import { resetConnectionStatus, setServerConnectionStatus, setVoiceConnectionStatus } from '../ui/status';
import { resetPushToTalkState } from '../ui/controls';
import { stopLocalScreenStream } from '../services/screen-share-service';
import { stopLocalCamera } from '../services/camera-service';
import { closeScreenView, refreshScreenStage } from '../ui/screen-view';
import { createParticipant, removeAudioElements, updatePeerStatus } from './participants';
import { connectLiveKitRoom, disconnectLiveKitRoom, syncRemoteVideoVisibility } from '../services/livekit-service';
import { formatJoinError, LiveKitTransportError } from './join-error';
import { loadLiveKitClient } from '../media/livekit-runtime';
import {
  describeMicrophoneError,
  getLocalMicrophoneCapture,
  getMicrophoneCaptureDiagnostics,
  stopMicrophoneCapture
} from '../services/microphone-service';
import { attachMeter, startMeters, stopMeters } from '../media/meters';
import { startPeerLatencyStats, stopPeerLatencyStats } from './stats';
import { relieveVideo } from '../services/video-relief';
import { clearAllPeerJoinCues, clearStreamViewerCues, playPeerCue } from '../media/cues';
import { cancelScreenSourcePicker } from '../ui/screen-source-picker';
import { syncDesktopGlobalHotkeys } from '../services/desktop-hotkey-service';
import {
  clearGateSwitchTimer,
  closeDevicePopover,
  closeCameraPopover,
  closeOutputPopover,
  refreshDevices,
  acquireMicrophoneForJoin,
  disposePreparedMicrophoneForJoin,
  canAdmitAutomaticMicrophoneAction,
  invalidateMicrophoneActions,
  startMicrophoneCall,
  setMicrophoneRecoveryObserver,
  getMicrophoneCallGeneration,
  requestAutomaticMicrophoneConnectionReplacement,
  refreshMicrophoneLevelMeter,
  relieveNoiseSuppression,
  reopenMicrophone,
  watchLocalMicrophone
} from '../ui/devices';
import { startCpuPressureWatch, stopCpuPressureWatch } from '../services/cpu-pressure';
import { noteCpuPressure, startCallStrainWatch, stopCallStrainWatch } from './call-strain';
import { canRecoverMic, startMicSendWatch, stopMicSendWatch } from './mic-send';
import {
  noteCaptureRecovery,
  noteProcessingRelief,
  startCaptureDiagnostics,
  stopCaptureDiagnostics
} from './capture-diagnostics';
import {
  finishCallQuality,
  type CallQualitySummary,
  recordCpuPressure,
  recordCpuRelief,
  recordPeerCount,
  startCallQuality
} from './call-quality';
import { GATE_THRESHOLD_MIN_DB } from '../core/config';
import { resolveRoomEntryName } from './room-entry';
import { createVoiceEventHandler } from './voice-events';
import { isMicrophoneShownMuted } from '../core/microphone-mute';
import type { MicrophoneCapture } from '../core/types';
import {
  cancelRoomRecovery,
  abandonOptionalLiveKitReplacement,
  notifyRoomAppConnection,
  notifyRoomNetworkOffline,
  notifyRoomNetworkOnline,
  requestLiveKitReplacement,
  notifyLiveKitReconciled,
  startRoomRecovery
} from '../recovery/room-recovery';

import { createLogger, errorContext } from '../diagnostics';

const log = createLogger('room');

let voiceJoinSent = false;
let stopVideoVisibilitySync: (() => void) | null = null;
let joinAttemptGeneration = 0;
let activeJoinAttempt: Promise<void> | null = null;
let finishJoinTelemetry: ((outcome: 'failure' | 'cancel') => void) | null = null;

const handleVoiceEvent = createVoiceEventHandler({
  leaveRoom: () => {
    finishJoinTelemetry?.('failure');
    leaveRoom();
  },
  showModeration: (reason) => showRoomModerationScreen(reason),
  showNotFound: () => showRoomNotFound()
});

function isCurrentJoinAttempt(generation: number): boolean {
  return generation === joinAttemptGeneration;
}

export function showStartScreen(): void {
  callPageState().$patch({ screen: 'start' });
  document.title = 'VoiceRoom';
  updateNameStatuses();
}

export async function showRoomRoute(): Promise<boolean> {
  callPageState().$patch({ screen: 'checking' });

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

export function showRoomScreen(): void {
  callPageState().$patch({ screen: 'room' });
  refreshRoomHeading();
  resetConnectionStatus();

  updateNameStatuses();
  refreshScreenStage();
}

export function showRoomEntryFailure(): void {
  leaveRoom();
  callPageState().$patch({ screen: 'entry-error' });
  document.title = t('Не удалось проверить вход · VoiceRoom');
}

export function showRoomNotFound(): void {
  finishJoinTelemetry?.('failure');
  leaveRoom();
  callPageState().$patch({ screen: 'not-found' });
  document.title = t('Комната не найдена · VoiceRoom');
  useStartUiStore().missingRoomCode = state.roomId || state.missingRoomLabel || 'room';
}

function showRoomModerationScreen(reason: 'banned' | 'kicked'): void {
  finishJoinTelemetry?.('failure');
  leaveRoom();
  const nextSession = getCallPorts().identity.rotateCredentials(state.roomId);
  state.peerId = nextSession.peerId;
  state.sessionToken = nextSession.sessionToken;
  state.moderationReason = reason;
  callPageState().$patch({ screen: 'moderation' });
  document.title = reason === 'banned' ? t('Доступ к комнате закрыт · VoiceRoom') : t('Вы исключены · VoiceRoom');
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
  let pendingMicrophoneCapture: MicrophoneCapture | null = null;
  const startedAt = performance.now();
  // Keep the original attempt's context if navigation or sign-in changes while
  // the microphone/network is pending. Reuse the guest id already sent on joins.
  const roomId = state.roomId;
  const reportedGuestId = getCallPorts().identity.current().feedbackGuestId || '';
  let reported = false;
  const reportOutcome = (outcome: 'success' | 'failure' | 'cancel'): void => {
    if (reported) return;
    reported = true;
    getCallPorts().diagnostics.reportJoinOutcome({
      outcome,
      elapsedMs: Math.round(performance.now() - startedAt),
      stage: lastJoinStage(),
      roomId,
      ...(reportedGuestId ? { reportedGuestId } : {})
    });
    if (finishJoinTelemetry === finishPending) finishJoinTelemetry = null;
  };
  const finishPending = (outcome: 'failure' | 'cancel'): void => reportOutcome(outcome);
  finishJoinTelemetry = finishPending;

  startJoinTiming();
  state.connecting = true;
  state.localConnectionQuality = 'unknown';
  state.localPingMs = null;
  state.localNetwork = { inboundLossPct: null, jitterMs: null, outboundLossPct: null, transport: null };
  state.voiceQuality = null;
  resetConnectionStatus();
  setServerConnectionStatus('connecting');
  setVoiceConnectionStatus('idle');

  try {
    if (state.outputMuted) {
      state.micMutedBeforeOutputMute = state.muted;
      state.muted = true;
    }
    if (state.microphoneMode === 'push-to-talk') state.muted = true;

    // The library downloads while the microphone opens (a permission prompt can
    // take a while), not after the token. A failure here is retried at connect.
    loadLiveKitClient().catch(() => {});
    // Side by side: every step that waits for another is one more round trip
    // for a visitor far from the server.
    const roomCheck = roomCheckIsFresh(state.roomId) ? Promise.resolve(true) : checkRoomExists(state.roomId);
    const openingMicrophone = openJoinMicrophone(isCurrent);
    const discardMicrophone = () =>
      openingMicrophone.then((capture) => {
        if (capture) disposePreparedMicrophoneForJoin(capture);
      });
    let exists: boolean;
    try {
      exists = await roomCheck;
    } catch (error) {
      void discardMicrophone();
      throw error;
    }
    if (!isCurrent() || !exists) {
      void discardMicrophone();
      if (isCurrent()) {
        reportOutcome('failure');
        showRoomNotFound();
      }
      return;
    }
    const microphoneCapture = await openingMicrophone;
    pendingMicrophoneCapture = microphoneCapture;
    if (!isCurrent()) {
      return;
    }
    markJoinStage('microphoneMs');
    if (!microphoneCapture) {
      state.microphoneMissing = true;
    }
    await refreshDevices().catch((error: unknown) => log.warn('device list failed', errorContext(error)));
    if (!isCurrent()) return;

    const name = getDisplayName();
    state.self = createParticipant({
      id: state.peerId,
      deafened: state.outputMuted,
      isLocal: true,
      joinedAt: Date.now(),
      muted: isMicrophoneShownMuted(),
      name,
      avatarAccent: getCallPorts().identity.current().profile?.avatarAccent || '',
      avatarColorKey: getCallPorts().identity.current().profile?.avatarColorKey || '',
      avatarUrl: getCallPorts().identity.current().profile?.avatarUrl || ''
    });
    updatePeerStatus(state.self);

    const realtime = getCallPorts().transport.realtime;
    realtime.ensureConnected();
    state.voiceRealtimeTeardown?.();
    const detachVoiceEvents = realtime.subscribeRoom(state.roomId, (event) => {
      handleVoiceEvent(event).catch((err: unknown) => {
        log.error('voice realtime handler failed', errorContext(err));
      });
    });

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
    realtime.join({
      roomId: state.roomId,
      peerId: state.peerId,
      sessionToken: state.sessionToken,
      name
    });
    voiceJoinSent = true;
    setServerConnectionStatus('connecting');

    const connected = await connectLiveKitRoom(name, isCurrent, microphoneCapture);
    if (!connected || !isCurrent()) {
      if (microphoneCapture && state.localStream === microphoneCapture.stream) stopLocalStream();
      if (isCurrent()) reportOutcome('failure');
      return;
    }
    if (microphoneCapture && state.localStream === microphoneCapture.stream) watchLocalMicrophone();
    attachMeter(state.self, state.localStream);
    notifyLiveKitReconciled();
    state.joined = true;
    startMicrophoneCall();
    startCaptureDiagnostics();
    setMicrophoneRecoveryObserver(noteCaptureRecovery);
    finishJoinTiming();
    reportOutcome('success');
    useVoiceSessionStore().setConnectedVoiceRoom(state.roomId);
    void syncDesktopGlobalHotkeys(true);
    useVoiceSessionStore().setVoiceSessionTiming({ joinedAt: state.self?.joinedAt ?? Date.now() });
    useVoiceSessionStore().setVoiceControlsState({ muted: isMicrophoneShownMuted(), deafened: state.outputMuted });
    if (isMicrophoneShownMuted() || state.outputMuted) postState().catch(() => {});
    startMeters();
    startPeerLatencyStats();
    // Remote video pauses in the tray, minimized, covered or in a background tab.
    stopVideoVisibilitySync?.();
    stopVideoVisibilitySync = getCallPorts().platform.onVisibilityChange(() => syncRemoteVideoVisibility());
    syncRemoteVideoVisibility();
    // A question still open about an earlier call would now be about this one.
    getCallPorts().feedback.drop();
    startCallQuality();
    recordPeerCount(state.peers.size);
    // Relief comes from the call showing strain (call-strain.ts), not from a busy system alone.
    startCallStrainWatch(() => {
      // The noise suppression and, silently, the video (video-relief.ts).
      const reliefGeneration = getMicrophoneCallGeneration();
      const reliefRoomId = state.roomId;
      const reliefSessionToken = state.sessionToken;
      const reliefCurrent = () =>
        state.joined &&
        getMicrophoneCallGeneration() === reliefGeneration &&
        state.roomId === reliefRoomId &&
        state.sessionToken === reliefSessionToken;
      const noiseStarted = performance.now();
      const noteNoiseResult = (switched: boolean) => {
        if (!reliefCurrent()) return;
        if (switched) recordCpuRelief();
        const capture = getMicrophoneCaptureDiagnostics();
        noteProcessingRelief({
          generation: reliefGeneration,
          kind: 'noise',
          outcome: switched ? 'applied' : 'failed',
          requestedMode: 'browser',
          actualMode: capture.actualMode,
          durationMs: performance.now() - noiseStarted
        });
      };
      void relieveNoiseSuppression().then(noteNoiseResult, () => noteNoiseResult(false));
      const videoStarted = performance.now();
      void relieveVideo(({ kind, outcome }) => {
        if (!reliefCurrent()) return;
        if (outcome === 'applied') recordCpuRelief();
        noteProcessingRelief({
          generation: reliefGeneration,
          kind,
          outcome,
          requestedMode: null,
          actualMode: getMicrophoneCaptureDiagnostics().actualMode,
          durationMs: performance.now() - videoStarted
        });
      });
    });
    startMicSendWatch({
      reopen: reopenMicrophone,
      replace: () =>
        requestAutomaticMicrophoneConnectionReplacement(requestLiveKitReplacement, abandonOptionalLiveKitReplacement),
      canRecover: () => canRecoverMic() && canAdmitAutomaticMicrophoneAction()
    });
    startCpuPressureWatch({
      onState: (pressure, sampledAt) => {
        recordCpuPressure(pressure);
        noteCpuPressure(pressure, sampledAt);
      }
    });
    playPeerCue('join');
  } catch (error) {
    if (!isCurrent()) {
      // leaveRoom already cleaned this attempt's published state. Async capture,
      // token and LiveKit work self-disposes through the generation predicate.
      return;
    }
    reportOutcome('failure');
    log.error('room action failed', errorContext(error));
    const failure = getCallPorts().transport.failure(error);
    const banned = failure?.code === 'room_banned';
    if (!banned) showToast(formatJoinError(error, failure));
    setVoiceConnectionStatus(error instanceof LiveKitTransportError ? 'no-route' : 'error');
    if (voiceJoinSent && state.roomId && state.peerId && state.sessionToken) {
      getCallPorts().transport.realtime.leave({
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
    await disconnectLiveKitRoom();
    state.self = null;
    stopLocalStream();
    if (banned) showRoomModerationScreen('banned');
  } finally {
    if (pendingMicrophoneCapture && state.localStream !== pendingMicrophoneCapture.stream)
      disposePreparedMicrophoneForJoin(pendingMicrophoneCapture);
    if (isCurrent()) state.connecting = false;
  }
}

/**
 * A missing or refused microphone does not keep anyone out of the call: they
 * join to listen, and the microphone button or a plugged-in device adds it.
 */
async function openJoinMicrophone(isCurrent: () => boolean): Promise<MicrophoneCapture | null> {
  try {
    return await acquireMicrophoneForJoin(
      isCurrent,
      () => showToast(t('Микрофон не ответил вовремя: вы в комнате без микрофона'), { duration: 8000 }),
      () => showToast(t('Микрофон ещё занят прошлой операцией: вы в комнате без микрофона'), { duration: 8000 })
    );
  } catch (error) {
    log.warn('joining without a microphone', errorContext(error));
    if (isCurrent())
      showToast(t('{p0}: вы в комнате без микрофона', { p0: describeMicrophoneError(error) }), {
        duration: 8000
      });
    return null;
  }
}

export function leaveRoom(): void {
  invalidateMicrophoneActions();
  setMicrophoneRecoveryObserver(null);
  stopCaptureDiagnostics();
  finishJoinTelemetry?.('cancel');
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
  state.voiceQuality = null;
  clearGateSwitchTimer();
  if (state.roomId && state.peerId && state.sessionToken) {
    getCallPorts().transport.realtime.leave({
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
  getCallPorts().host.closeParticipantMenu();
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
  stopMicSendWatch();
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
function feedbackGuestIdentity(): { guestId?: string } {
  const identity = getCallPorts().identity.current();
  if (identity.kind === 'account') return {};
  const guestId = identity.feedbackGuestId;
  return guestId === undefined ? {} : { guestId };
}

function noteFinishedCall(roomId: string, summary: CallQualitySummary | null): void {
  if (!roomId || !summary) {
    getCallPorts().feedback.finished(null);
    return;
  }
  const { stats } = summary;
  const desktopApp = Boolean(getInstalledCallPorts()?.platform.desktop.runtime?.isDesktop);
  getCallPorts().feedback.finished({
    roomId,
    durationS: Math.min(stats.durationS, CALL_FEEDBACK_MAX_DURATION_S),
    peers: stats.peersMax,
    platform: desktopApp ? 'desktop_app' : getCallPorts().platform.policy().desktopAllowed ? 'browser' : 'mobile',
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
    ...feedbackGuestIdentity()
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
  const guest = !isRoomEmbedded() && getCallPorts().identity.current().kind === 'guest';
  // The lobby is desktop-only, so leaving on a phone stays on the room page.
  const mobile = !getCallPorts().platform.policy().desktopAllowed;
  if (state.joined || state.localStream || state.connecting) {
    playPeerCue('leave');
    await wait(180);
    leaveRoom();
    getCallPorts().feedback.offer();
  }

  if (isRoomEmbedded()) {
    getRoomShell().roomLeft(roomId);
    return;
  }

  if ((guest || mobile) && roomId) {
    getCallPorts().host.showLeaveScreen({ roomId, isStatic: state.roomIsStatic, guest });
    return;
  }

  getCallPorts().platform.goHome();
}

/**
 * A guest who just created an account comes back to the same room as that
 * account. The session is not swapped in place: that would unmount this call
 * mid-flight and let the lobby offer the desktop app again. Instead the call is
 * left cleanly and the room page reloads signed in, with the in-app mark set so
 * the reload joins in the browser.
 */
export async function rejoinRoomSignedIn(roomId: string): Promise<void> {
  getCallPorts().platform.prepareRoomNavigation();
  try {
    if (state.joined || state.localStream || state.connecting) {
      playPeerCue('leave');
      await wait(180);
      leaveRoom();
    }
  } catch (error) {
    log.error('guest register rejoin failed', errorContext(error));
  }
  getCallPorts().platform.navigateToRoom(roomId, 'assign');
}
