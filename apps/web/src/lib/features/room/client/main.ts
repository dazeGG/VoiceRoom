import { GATE_THRESHOLD_MIN_DB } from './core/config';
import { elements, setElementsRoot } from './ui/dom';
import { mountIcons } from './ui/icons';
import { state } from './core/state';
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
  switchMicrophone,
  switchNoiseMode,
  switchOutputDevice,
  toggleDevicePopover,
  toggleOutputPopover,
  updateGateThresholdFromSlider
} from './ui/devices';
import { handleMicButtonClick, refreshOutputControls, toggleOutputMute } from './ui/controls';
import { bindGuestNameDialog, resetGuestNameDialog, saveStartName, unbindGuestNameDialog, updateNameStatuses } from './ui/names';
import {
  copyRoomCode,
  copyRoomLink,
  createRoomFromStart,
  handleLeaveButtonClick,
  handleRoomCodeKeydown,
  joinRoomByCode,
  leaveRoom,
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

let mounted = false;
let mountAbortController: AbortController | null = null;

export function mountRoomClient(root: ParentNode = document): () => void {
  if (mounted) return unmountRoomClient;
  mounted = true;
  setElementsRoot(root);
  mountAbortController = new AbortController();
  const listenerSignal = mountAbortController.signal;

  mountIcons();
  mountIcons(elements.template.content);

  const savedName = cleanDisplayName(localStorage.getItem('voice-room:name'));
  state.savedName = savedName;
  elements.startNameInput.value = savedName;
  elements.noiseModeSelect.value = state.noiseMode;
  elements.gateThresholdSlider.value = String(state.gateThresholdDb);
  refreshGateThresholdValue();
  refreshMicrophoneLevelMeter(GATE_THRESHOLD_MIN_DB);
  elements.startForm.addEventListener('submit', saveStartName, { signal: listenerSignal });
  bindGuestNameDialog();
  elements.createRoomButton.addEventListener('click', createRoomFromStart, { signal: listenerSignal });
  elements.joinByCodeButton.addEventListener('click', joinRoomByCode, { signal: listenerSignal });
  elements.roomCodeInput.addEventListener('keydown', handleRoomCodeKeydown, { signal: listenerSignal });
  elements.startNameInput.addEventListener('input', updateNameStatuses, { signal: listenerSignal });
  elements.copyCodeButton.addEventListener('click', copyRoomCode, { signal: listenerSignal });
  elements.copyLinkButton.addEventListener('click', copyRoomLink, { signal: listenerSignal });
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
  bindScreenStageIdleUi();
  elements.deviceMenuButton.addEventListener('click', toggleDevicePopover, { signal: listenerSignal });
  elements.outputMenuButton.addEventListener('click', toggleOutputPopover, { signal: listenerSignal });
  elements.leaveButton.addEventListener('click', handleLeaveButtonClick, { signal: listenerSignal });
  elements.soundButton.addEventListener('click', () => unlockAudio().catch((error) => console.warn('Audio unlock failed', error)), { signal: listenerSignal });
  elements.deviceSelect.addEventListener('change', () => switchMicrophone(), { signal: listenerSignal });
  elements.gateThresholdSlider.addEventListener('input', updateGateThresholdFromSlider, { signal: listenerSignal });
  elements.micLevelTrack.addEventListener('pointerdown', handleGateThresholdPointerDown, { signal: listenerSignal });
  elements.noiseModeSelect.addEventListener('change', switchNoiseMode, { signal: listenerSignal });
  elements.outputDeviceSelect.addEventListener('change', switchOutputDevice, { signal: listenerSignal });
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

  return unmountRoomClient;
}

function unmountRoomClient(): void {
  mountAbortController?.abort();
  mountAbortController = null;
  resetGuestNameDialog();
  unbindGuestNameDialog();
  mounted = false;
}
