import { GATE_THRESHOLD_MIN_DB } from './core/config';
import { roomDeviceUi } from '$lib/features/room/room-device-ui.svelte';
import { registerActiveVoiceLeave } from '$lib/features/room/voice-session.svelte';
import { elements, setElementsRoot } from './ui/dom';
import { mountIcons } from './ui/icons';
import { state } from './core/state.svelte';
import { getStoredPeerSession } from './core/session';
import { cleanDisplayName } from './core/utils';
import { showToast } from './ui/toast';
import { handleAudioUnlockGesture, unlockAudio } from './services/media-playback-service';
import {
  closeDevicePopoverOnEscape,
  closeDevicePopoverOnOutside,
  closeOutputPopoverOnEscape,
  closeOutputPopoverOnOutside,
  handleGateThresholdPointerDown,
  refreshDevices,
  refreshGateThresholdValue,
  refreshMicrophoneLevelMeter,
  toggleDevicePopover,
  toggleOutputPopover,
  updateGateThresholdFromSlider
} from './ui/devices';
import { handleMicButtonClick, refreshOutputControls, toggleOutputMute } from './ui/controls';
import { bindGuestNameDialog, resetGuestNameDialog, saveStartName, unbindGuestNameDialog, updateNameStatuses } from './ui/names';
import {
  createRoomFromStart,
  handleLeaveButtonClick,
  handleRoomCodeKeydown,
  joinRoom,
  joinRoomByCode,
  leaveRoom,
  showRoomEntryFailure,
  showRoomNotFound,
  showRoomRoute,
  showStartScreen
} from './room/room';
import { handleScreenButtonClick } from './services/screen-share-service';
import {
  bindScreenStageIdleUi,
  handleScreenStageClick,
  leaveScreenView,
  refreshStageStripControls,
  syncScreenVideoAudio,
  toggleScreenFullscreen,
  toggleScreenMute,
  updateScreenFullscreenState,
  updateScreenVolumeFromSlider
} from './ui/screen-view';
import { cancelScreenSourcePicker, closeScreenSourceOnBackdrop, closeScreenSourceOnEscape } from './ui/screen-source-picker';
import { refreshLocalNetworkIndicator } from './ui/status';
import { bindParticipantContextMenu } from './ui/participant-context-menu';

let mounted = false;
let mountAbortController: AbortController | null = null;
let activeVoiceLeaveTeardown: (() => void) | null = null;

export function mountRoomClient(root: ParentNode = document, options: { roomId?: string; embeddedRoomId?: string; autoJoin?: boolean } = {}): () => void {
  if (mounted) return unmountRoomClient;
  mounted = true;
  setElementsRoot(root);
  mountAbortController = new AbortController();
  const listenerSignal = mountAbortController.signal;
  activeVoiceLeaveTeardown = registerActiveVoiceLeave(leaveRoom);

  const mountedRoomId = options.roomId || options.embeddedRoomId || '';
  if (mountedRoomId) {
    const peerSession = getStoredPeerSession(mountedRoomId);
    state.connecting = false;
    state.joined = false;
    state.eventSource?.close();
    state.eventSource = null;
    state.peers.clear();
    state.participantViews.clear();
    state.serverPeerIds.clear();
    state.serverPeerSyncReady = false;
    state.self = null;
    state.roomName = '';
    state.roomEmoji = '';
    state.roomColorKey = '';
    state.roomIconKey = '';
    state.roomPresetKey = '';
    state.roomId = mountedRoomId;
    state.roomRoute = true;
    state.peerId = peerSession.peerId;
    state.sessionToken = peerSession.sessionToken;
  }

  mountIcons();
  mountIcons(elements.template.content);

  const savedName = cleanDisplayName(localStorage.getItem('voice-room:name'));
  state.savedName = savedName;
  elements.startNameInput.value = savedName;
  roomDeviceUi.noiseMode = state.noiseMode;
  elements.gateThresholdSlider.value = String(state.gateThresholdDb);
  refreshGateThresholdValue();
  refreshMicrophoneLevelMeter(GATE_THRESHOLD_MIN_DB);
  elements.startForm.addEventListener('submit', saveStartName, { signal: listenerSignal });
  bindGuestNameDialog();
  elements.createRoomButton.addEventListener('click', createRoomFromStart, { signal: listenerSignal });
  elements.joinByCodeButton.addEventListener('click', joinRoomByCode, { signal: listenerSignal });
  elements.roomCodeInput.addEventListener('keydown', handleRoomCodeKeydown, { signal: listenerSignal });
  elements.startNameInput.addEventListener('input', updateNameStatuses, { signal: listenerSignal });

  elements.muteButton.addEventListener('click', handleMicButtonClick, { signal: listenerSignal });
  elements.outputButton.addEventListener('click', toggleOutputMute, { signal: listenerSignal });
  elements.screenButton.addEventListener('click', handleScreenButtonClick, { signal: listenerSignal });
  elements.screenExitButton.addEventListener('click', () => leaveScreenView({ keepPreview: false }).catch((error) => console.error(error)), { signal: listenerSignal });
  elements.screenStage.addEventListener('click', handleScreenStageClick, { signal: listenerSignal });
  elements.screenFullscreenButton.addEventListener('click', toggleScreenFullscreen, { signal: listenerSignal });
  elements.screenSourceCloseButton.addEventListener('click', cancelScreenSourcePicker, { signal: listenerSignal });
  elements.screenSourceDialog.addEventListener('click', closeScreenSourceOnBackdrop, { signal: listenerSignal });
  elements.streamVolumeButton.addEventListener('click', toggleScreenMute, { signal: listenerSignal });
  elements.streamVolumeSlider.addEventListener('input', updateScreenVolumeFromSlider, { signal: listenerSignal });
  syncScreenVideoAudio();
  bindScreenStageIdleUi(listenerSignal);
  bindParticipantContextMenu(listenerSignal);
  elements.deviceMenuButton.addEventListener('click', toggleDevicePopover, { signal: listenerSignal });
  elements.outputMenuButton.addEventListener('click', toggleOutputPopover, { signal: listenerSignal });
  elements.leaveButton.addEventListener('click', handleLeaveButtonClick, { signal: listenerSignal });
  elements.soundButton.addEventListener('click', () => unlockAudio().catch((error) => console.warn('Audio unlock failed', error)), { signal: listenerSignal });
  elements.gateThresholdSlider.addEventListener('input', updateGateThresholdFromSlider, { signal: listenerSignal });
  elements.micLevelTrack.addEventListener('pointerdown', handleGateThresholdPointerDown, { signal: listenerSignal });
  document.addEventListener('click', closeDevicePopoverOnOutside, { signal: listenerSignal });
  document.addEventListener('click', closeOutputPopoverOnOutside, { signal: listenerSignal });
  document.addEventListener('keydown', closeDevicePopoverOnEscape, { signal: listenerSignal });
  document.addEventListener('keydown', closeOutputPopoverOnEscape, { signal: listenerSignal });
  document.addEventListener('keydown', closeScreenSourceOnEscape, { signal: listenerSignal });
  document.addEventListener('pointerdown', handleAudioUnlockGesture, { passive: true, signal: listenerSignal });
  document.addEventListener('keydown', handleAudioUnlockGesture, { signal: listenerSignal });
  document.addEventListener('fullscreenchange', updateScreenFullscreenState, { signal: listenerSignal });
  navigator.mediaDevices?.addEventListener?.('devicechange', () => refreshDevices().catch(() => {}), { signal: listenerSignal });
  window.addEventListener('beforeunload', leaveRoom, { signal: listenerSignal });
  refreshOutputControls();
  refreshStageStripControls();
  refreshLocalNetworkIndicator();

  function runRoomRoute(): void {
    showRoomRoute()
      .then((ready) => {
        if (ready && options.autoJoin) return joinRoom();
      })
      .catch((error) => {
        console.error(error);
        showRoomEntryFailure();
        showToast('Не удалось проверить комнату');
      });
  }

  elements.entryRetryButton.addEventListener('click', runRoomRoute, { signal: listenerSignal });

  if (state.roomRoute && !state.roomId) {
    showRoomNotFound();
  } else if (state.roomId) {
    runRoomRoute();
  } else {
    showStartScreen();
  }

  return unmountRoomClient;
}

function unmountRoomClient(): void {
  leaveRoom();
  activeVoiceLeaveTeardown?.();
  activeVoiceLeaveTeardown = null;
  mountAbortController?.abort();
  mountAbortController = null;
  resetGuestNameDialog();
  unbindGuestNameDialog();
  mounted = false;
}
