import { defineStore } from 'pinia';
import { ref } from 'vue';
import { GATE_THRESHOLD_MIN_DB } from './client/core/config';
import type { SelectOption } from '@/shared/ui/Select/types';

export const NOISE_MODE_SELECT_OPTIONS: SelectOption[] = [
  { value: 'off', label: 'Выкл' },
  { value: 'browser', label: 'Браузерный' },
  { value: 'rnnoise', label: 'RNNoise' }
];

export const useRoomDeviceUiStore = defineStore('room-device-ui', () => {
  const microphoneId = ref('');
  const outputDeviceId = ref('');
  const cameraId = ref('');
  const noiseMode = ref('off');
  const microphoneOptions = ref<SelectOption[]>([{ value: '', label: 'Системный' }]);
  const outputOptions = ref<SelectOption[]>([{ value: '', label: 'Системный' }]);
  const cameraOptions = ref<SelectOption[]>([{ value: '', label: 'Системная' }]);
  const outputDisabled = ref(false);
  const devicePopoverOpen = ref(false);
  const outputPopoverOpen = ref(false);
  const cameraPopoverOpen = ref(false);
  const microphoneVolume = ref(100);
  const micLevelDb = ref(GATE_THRESHOLD_MIN_DB);
  return {
    microphoneId,
    outputDeviceId,
    cameraId,
    noiseMode,
    microphoneOptions,
    outputOptions,
    cameraOptions,
    outputDisabled,
    devicePopoverOpen,
    outputPopoverOpen,
    cameraPopoverOpen,
    microphoneVolume,
    micLevelDb
  };
});
