import { GATE_THRESHOLD_MIN_DB } from './client/core/config';
import type { SelectOption } from '$lib/shared/ui';

export const NOISE_MODE_SELECT_OPTIONS: SelectOption[] = [
  { value: 'off', label: 'Выкл' },
  { value: 'browser', label: 'Браузерный' },
  { value: 'rnnoise', label: 'RNNoise' }
];

export const roomDeviceUi = $state({
  microphoneId: '',
  outputDeviceId: '',
  noiseMode: 'off',
  microphoneOptions: [{ value: '', label: 'Системный' }] as SelectOption[],
  outputOptions: [{ value: '', label: 'Системный' }] as SelectOption[],
  outputDisabled: false,
  devicePopoverOpen: false,
  outputPopoverOpen: false,
  micLevelDb: GATE_THRESHOLD_MIN_DB
});