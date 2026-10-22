import { GATE_THRESHOLD_MIN_DB } from './client/core/config';
import type { SelectOption } from '$lib/shared/ui';

export const NOISE_MODE_SELECT_OPTIONS: SelectOption[] = [
  { value: 'off', label: 'Выкл' },
  { value: 'browser', label: 'Браузерный' },
  { value: 'rnnoise', label: 'RNNoise' }
];

interface RoomDeviceUiState {
  microphoneId: string;
  outputDeviceId: string;
  cameraId: string;
  noiseMode: string;
  microphoneOptions: SelectOption[];
  outputOptions: SelectOption[];
  cameraOptions: SelectOption[];
  outputDisabled: boolean;
  devicePopoverOpen: boolean;
  outputPopoverOpen: boolean;
  cameraPopoverOpen: boolean;
  microphoneVolume: number;
  micLevelDb: number;
}

export const roomDeviceUi = $state<RoomDeviceUiState>({
  microphoneId: '',
  outputDeviceId: '',
  cameraId: '',
  noiseMode: 'off',
  microphoneOptions: [{ value: '', label: 'Системный' }],
  outputOptions: [{ value: '', label: 'Системный' }],
  cameraOptions: [{ value: '', label: 'Системная' }],
  outputDisabled: false,
  devicePopoverOpen: false,
  outputPopoverOpen: false,
  cameraPopoverOpen: false,
  microphoneVolume: 100,
  micLevelDb: GATE_THRESHOLD_MIN_DB
});
