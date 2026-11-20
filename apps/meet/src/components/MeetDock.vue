<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue';
import { DeviceSettings, RoomDock, type CallDevice } from '@voice-room/call/views';
import type { RoomCapabilities } from '@voice-room/shared/contracts/rooms';
import { useRoomDeviceUiStore } from '@voice-room/call/engine/core/room-device-ui.store';
import { useScreenUiStore } from '@voice-room/call/engine/core/screen-ui.store';
import { setMicrophoneLevelReporting } from '@voice-room/call/engine/media/meters';
import { switchCamera, toggleCamera } from '@voice-room/call/engine/services/camera-service';
import { setMicrophoneVolume } from '@voice-room/call/engine/services/microphone-service';
import { handleScreenButtonClick } from '@voice-room/call/engine/services/screen-share-service';
import {
  getCallControlsView,
  getCameraControlsView,
  getOutputControlsView,
  getScreenControlsView,
  handleMicButtonClick,
  toggleOutputMute
} from '@voice-room/call/engine/ui/controls';
import {
  getGateControlView,
  refreshDevices,
  switchMicrophone,
  switchNoiseMode,
  switchOutputDevice,
  toggleGate,
  updateGateThresholdFromSlider
} from '@voice-room/call/engine/ui/devices';
import { leaveScreenView } from '@voice-room/call/engine/ui/screen-view';
import { getConnectionStatusView } from '@voice-room/call/engine/ui/status';

const props = defineProps<{ capabilities: RoomCapabilities | null }>();
const emit = defineEmits<{ leave: [] }>();
const devices = useRoomDeviceUiStore();
const screen = useScreenUiStore();
const connection = computed(getConnectionStatusView);
const callControls = computed(getCallControlsView);
const outputControls = computed(getOutputControlsView);
const screenControls = computed(() => {
  const view = getScreenControlsView();
  return {
    ...view,
    disabled: view.disabled || !props.capabilities?.screenShare || !navigator.mediaDevices?.getDisplayMedia
  };
});
const cameraControls = computed(() => {
  const view = getCameraControlsView();
  return { ...view, disabled: view.disabled || !props.capabilities?.camera };
});
const gate = computed(getGateControlView);
const menuFields = {
  microphone: 'devicePopoverOpen',
  output: 'outputPopoverOpen',
  camera: 'cameraPopoverOpen'
} as const;

watch(() => devices.devicePopoverOpen, setMicrophoneLevelReporting);
onBeforeUnmount(() => setMicrophoneLevelReporting(false));

function updateDeviceMenu(device: CallDevice, open: boolean): void {
  devices[menuFields[device]] = open;
}

function toggleDeviceMenu(device: CallDevice): void {
  if (device === 'camera' && !props.capabilities?.camera) return;
  const open = !devices[menuFields[device]];
  for (const field of Object.values(menuFields)) devices[field] = false;
  updateDeviceMenu(device, open);
  if (open) void refreshDevices();
}

async function selectDevice(device: CallDevice | 'noiseMode', id: string): Promise<void> {
  switch (device) {
    case 'microphone':
      devices.microphoneId = id;
      await switchMicrophone();
      break;
    case 'output':
      devices.outputDeviceId = id;
      await switchOutputDevice();
      break;
    case 'camera':
      if (!props.capabilities?.camera) return;
      devices.cameraId = id;
      await switchCamera(id);
      break;
    case 'noiseMode':
      devices.noiseMode = id;
      await switchNoiseMode();
      break;
  }
}

function setVolume(value: number): void {
  devices.microphoneVolume = value;
  setMicrophoneVolume(value);
}
</script>

<template>
  <RoomDock
    :connection="connection"
    :call-controls="callControls"
    :output-controls="outputControls"
    :screen-controls="screenControls"
    :camera-controls="cameraControls"
    :push-to-talk="false"
    :push-to-talk-active="false"
    :microphone-menu="devices.devicePopoverOpen"
    :output-menu="devices.outputPopoverOpen"
    :camera-menu="devices.cameraPopoverOpen && Boolean(capabilities?.camera)"
    :hide-leave-button="false"
    :show-screen-exit="screen.showScreenExit"
    @toggle-microphone="handleMicButtonClick"
    @toggle-output="toggleOutputMute()"
    @toggle-camera="toggleCamera()"
    @toggle-screen="handleScreenButtonClick"
    @leave="emit('leave')"
    @exit-screen="leaveScreenView({ keepPreview: false })"
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
