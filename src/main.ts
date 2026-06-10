import './styles.css';
import { GATE_THRESHOLD_MIN_DB } from './core/config';
import { elements } from './ui/dom';
import { mountIcons } from './ui/icons';
import { state } from './core/state';
import { cleanDisplayName } from './core/utils';
import { showToast } from './ui/toast';
import { handleAudioUnlockGesture, unlockAudio } from './media/playback';
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
import { saveStartName, updateNameStatuses } from './ui/names';
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
import { handleScreenButtonClick } from './room/screen-share';
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
import { cancelScreenSourcePicker, closeScreenSourceOnBackdrop, closeScreenSourceOnEscape } from './media/screen-capture';
import { refreshLocalNetworkIndicator } from './ui/status';

function init(): void {
  mountIcons();
  mountIcons(elements.template.content);

  const savedName = cleanDisplayName(localStorage.getItem('voice-room:name'));
  state.savedName = savedName;
  elements.startNameInput.value = savedName;
  elements.noiseModeSelect.value = state.noiseMode;
  elements.gateThresholdSlider.value = String(state.gateThresholdDb);
  refreshGateThresholdValue();
  refreshMicrophoneLevelMeter(GATE_THRESHOLD_MIN_DB);
  elements.startForm.addEventListener('submit', saveStartName);
  elements.createRoomButton.addEventListener('click', createRoomFromStart);
  elements.joinByCodeButton.addEventListener('click', joinRoomByCode);
  elements.roomCodeInput.addEventListener('keydown', handleRoomCodeKeydown);
  elements.startNameInput.addEventListener('input', updateNameStatuses);
  elements.copyCodeButton.addEventListener('click', copyRoomCode);
  elements.copyLinkButton.addEventListener('click', copyRoomLink);
  elements.muteButton.addEventListener('click', handleMicButtonClick);
  elements.outputButton.addEventListener('click', toggleOutputMute);
  elements.screenButton.addEventListener('click', handleScreenButtonClick);
  elements.screenExitButton.addEventListener('click', () => leaveScreenView().catch((error) => console.error(error)));
  elements.screenStage.addEventListener('click', handleScreenStageClick);
  elements.screenFullscreenButton.addEventListener('click', toggleScreenFullscreen);
  elements.screenSourceCloseButton.addEventListener('click', cancelScreenSourcePicker);
  elements.screenSourceDialog.addEventListener('click', closeScreenSourceOnBackdrop);
  elements.streamVolumeButton.addEventListener('click', toggleScreenMute);
  elements.streamVolumeSlider.addEventListener('input', updateScreenVolumeFromSlider);
  syncScreenVideoAudio();
  bindScreenStageIdleUi();
  elements.deviceMenuButton.addEventListener('click', toggleDevicePopover);
  elements.outputMenuButton.addEventListener('click', toggleOutputPopover);
  elements.leaveButton.addEventListener('click', handleLeaveButtonClick);
  elements.soundButton.addEventListener('click', () => unlockAudio().catch((error) => console.warn('Audio unlock failed', error)));
  elements.deviceSelect.addEventListener('change', () => switchMicrophone());
  elements.gateThresholdSlider.addEventListener('input', updateGateThresholdFromSlider);
  elements.micLevelTrack.addEventListener('pointerdown', handleGateThresholdPointerDown);
  elements.noiseModeSelect.addEventListener('change', switchNoiseMode);
  elements.outputDeviceSelect.addEventListener('change', switchOutputDevice);
  document.addEventListener('click', closeDevicePopoverOnOutside);
  document.addEventListener('click', closeOutputPopoverOnOutside);
  document.addEventListener('keydown', closeDevicePopoverOnEscape);
  document.addEventListener('keydown', closeOutputPopoverOnEscape);
  document.addEventListener('keydown', closeScreenSourceOnEscape);
  document.addEventListener('pointerdown', handleAudioUnlockGesture, { passive: true });
  document.addEventListener('keydown', handleAudioUnlockGesture);
  document.addEventListener('fullscreenchange', updateScreenFullscreenState);
  navigator.mediaDevices?.addEventListener?.('devicechange', () => refreshDevices().catch(() => {}));
  window.addEventListener('beforeunload', leaveRoom);
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
}

init();
