<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue';
import { DeviceSettings, RoomDock, type CallDevice } from '@voiceroom/call/views';
import { useRoomDeviceUiStore } from '@voiceroom/call/engine/core/room-device-ui.store';
import { useScreenUiStore } from '@voiceroom/call/engine/core/screen-ui.store';
import { state } from '@voiceroom/call/engine/core/room-runtime.store';
import { setMicrophoneLevelReporting } from '@voiceroom/call/engine/media/meters';
import { handleLeaveButtonClick } from '@voiceroom/call/engine/room/room';
import { switchCamera, toggleCamera } from '@voiceroom/call/engine/services/camera-service';
import { setMicrophoneVolume } from '@voiceroom/call/engine/services/microphone-service';
import { handleScreenButtonClick } from '@voiceroom/call/engine/services/screen-share-service';
import {
  getCallControlsView,
  getCameraControlsView,
  getOutputControlsView,
  getScreenControlsView,
  handleMicButtonClick,
  toggleOutputMute
} from '@voiceroom/call/engine/ui/controls';
import {
  getGateControlView,
  refreshDevices,
  switchMicrophone,
  switchNoiseMode,
  switchOutputDevice,
  toggleGate,
  updateGateThresholdFromSlider
} from '@voiceroom/call/engine/ui/devices';
import { leaveScreenView } from '@voiceroom/call/engine/ui/screen-view';
import { getConnectionStatusView } from '@voiceroom/call/engine/ui/status';
import { createLogger, errorContext } from '@/shared/log';

const log = createLogger('room:dock');
withDefaults(defineProps<{ friendCall?: { groupLabel: string; leaveLabel: string; leave: () => void } | null }>(), {
  friendCall: null
});
const devices = useRoomDeviceUiStore();
const screenUi = useScreenUiStore();

const connection = computed(() => getConnectionStatusView());
const callControls = computed(() => getCallControlsView());
const outputControls = computed(() => getOutputControlsView());
const screenControls = computed(() => getScreenControlsView());
const cameraControls = computed(() => getCameraControlsView());
const gate = computed(() => getGateControlView());

const menuFields = {
  microphone: 'devicePopoverOpen',
  output: 'outputPopoverOpen',
  camera: 'cameraPopoverOpen'
} as const;

// The live microphone level is only reported while its popover is open.
watch(() => devices.devicePopoverOpen, setMicrophoneLevelReporting, { immediate: true });
onBeforeUnmount(() => setMicrophoneLevelReporting(false));

function updateDeviceMenu(device: CallDevice, open: boolean): void {
  devices[menuFields[device]] = open;
}

function toggleDeviceMenu(device: CallDevice): void {
  const open = !devices[menuFields[device]];
  for (const field of Object.values(menuFields)) {
    if (field !== menuFields[device]) devices[field] = false;
  }
  updateDeviceMenu(device, open);
  if (open) void refreshDevices();
}

function selectDevice(device: CallDevice | 'noiseMode', id: string): void {
  switch (device) {
    case 'microphone':
      devices.microphoneId = id;
      void switchMicrophone();
      break;
    case 'output':
      devices.outputDeviceId = id;
      void switchOutputDevice();
      break;
    case 'camera':
      devices.cameraId = id;
      void switchCamera(id);
      break;
    case 'noiseMode':
      devices.noiseMode = id;
      void switchNoiseMode();
      break;
  }
}

function setVolume(value: number): void {
  devices.microphoneVolume = value;
  setMicrophoneVolume(value);
}

function exitScreenView(): void {
  void leaveScreenView({ keepPreview: false }).catch((error: unknown) =>
    log.error('screen view action failed', errorContext(error))
  );
}
</script>

<template>
  <RoomDock
    :connection="connection"
    :call-controls="callControls"
    :output-controls="outputControls"
    :screen-controls="screenControls"
    :camera-controls="cameraControls"
    :push-to-talk="state.microphoneMode === 'push-to-talk'"
    :push-to-talk-active="state.pushToTalkActive"
    :microphone-menu="devices.devicePopoverOpen"
    :output-menu="devices.outputPopoverOpen"
    :camera-menu="devices.cameraPopoverOpen"
    :hide-leave-button="screenUi.hideLeaveButton"
    :show-screen-exit="screenUi.showScreenExit"
    :group-label="friendCall?.groupLabel"
    :leave-label="friendCall?.leaveLabel"
    @toggle-microphone="handleMicButtonClick"
    @toggle-output="toggleOutputMute()"
    @toggle-camera="void toggleCamera()"
    @toggle-screen="handleScreenButtonClick"
    @leave="friendCall ? friendCall.leave() : handleLeaveButtonClick()"
    @exit-screen="exitScreenView"
    @toggle-device-menu="toggleDeviceMenu"
    @update-device-menu="updateDeviceMenu"
  >
    <template #deviceSettings="{ device }">
      <DeviceSettings
        :device="device"
        :state="devices"
        :gate="gate"
        @select="selectDevice"
        @microphone-volume="setVolume"
        @toggle-gate="toggleGate"
        @gate-threshold="updateGateThresholdFromSlider"
      />
    </template>
  </RoomDock>
</template>
