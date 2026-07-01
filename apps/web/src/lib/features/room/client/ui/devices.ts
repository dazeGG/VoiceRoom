import {
  DEFAULT_GATE_THRESHOLD_DB,
  GATE_CAPTURE_SWITCH_DEBOUNCE_MS,
  GATE_THRESHOLD_DB_STORAGE_KEY,
  GATE_THRESHOLD_MIN_DB,
  MICROPHONE_DEVICE_STORAGE_KEY,
  OUTPUT_DEVICE_STORAGE_KEY,
  OUTPUT_MUTED_STORAGE_KEY
} from '../core/config';
import type { SelectOption } from '$lib/shared/ui';
import { roomDeviceUi } from '$lib/features/room/room-device-ui.svelte';
import { state } from '../core/state.svelte';
import { clampGateThresholdDb, getDbMeterPosition, getNoiseModeLabel } from '../core/settings';
import { showToast } from './toast';
import {
  getGateThresholdAmplitude,
  getLocalMicrophoneCapture,
  getMicrophoneProcessors,
  isGateDisabled,
  openLocalMicrophone,
  setLocalMicrophoneCapture,
  setNoiseMode,
  stopMicrophoneCapture
} from '../services/microphone-service';
import { publishLocalMicrophone, unpublishLocalMicrophone } from '../services/livekit-service';
import { supportsAudioOutputSelection, syncAudioOutputDevices } from '../services/media-playback-service';
import { attachMeter } from '../media/meters';
import { setParticipantSpeaking } from '../room/participants';
import { syncOutputDeviceUiState } from './controls';
import type { MicrophoneCapture } from '../core/types';

let gateSwitchTimer = 0;

export interface GateControlView {
  levelScale: number;
  levelState: 'open' | 'closed';
  markerActive: boolean;
  thresholdLabel: string;
  thresholdValue: number;
}

export function getGateControlView(): GateControlView {
  const levelDb = Number.isFinite(roomDeviceUi.micLevelDb) ? clampGateThresholdDb(roomDeviceUi.micLevelDb) : GATE_THRESHOLD_MIN_DB;
  const position = getDbMeterPosition(levelDb);
  const gateOpen = isGateDisabled() || levelDb >= state.gateThresholdDb;

  return {
    levelScale: position,
    levelState: gateOpen ? 'open' : 'closed',
    markerActive: !isGateDisabled(),
    thresholdLabel: isGateDisabled() ? 'Выкл' : `${state.gateThresholdDb} dB`,
    thresholdValue: state.gateThresholdDb
  };
}

export function clearGateSwitchTimer(): void {
  window.clearTimeout(gateSwitchTimer);
  gateSwitchTimer = 0;
}

export function setGateThresholdDb(value: string | number): void {
  const threshold = Number.parseInt(String(value), 10);
  state.gateThresholdDb = Number.isFinite(threshold) ? clampGateThresholdDb(threshold) : DEFAULT_GATE_THRESHOLD_DB;
  localStorage.setItem(GATE_THRESHOLD_DB_STORAGE_KEY, String(state.gateThresholdDb));
}

export function refreshMicrophoneLevelMeter(db: number): void {
  roomDeviceUi.micLevelDb = Number.isFinite(db) ? clampGateThresholdDb(db) : GATE_THRESHOLD_MIN_DB;
}

function persistMicrophoneDeviceId(deviceId: string): void {
  state.microphoneDeviceId = deviceId || '';
  if (state.microphoneDeviceId) {
    localStorage.setItem(MICROPHONE_DEVICE_STORAGE_KEY, state.microphoneDeviceId);
  } else {
    localStorage.removeItem(MICROPHONE_DEVICE_STORAGE_KEY);
  }
}

function persistOutputDeviceId(deviceId: string): void {
  state.outputDeviceId = deviceId || '';
  if (state.outputDeviceId) {
    localStorage.setItem(OUTPUT_DEVICE_STORAGE_KEY, state.outputDeviceId);
  } else {
    localStorage.removeItem(OUTPUT_DEVICE_STORAGE_KEY);
  }
}

export function persistOutputMuted(): void {
  localStorage.setItem(OUTPUT_MUTED_STORAGE_KEY, String(state.outputMuted));
}

export async function refreshDevices(): Promise<void> {
  if (!navigator.mediaDevices?.enumerateDevices) return;

  const activeMicrophoneId = getActiveMicrophoneDeviceId();
  const currentMicrophoneId = state.microphoneDeviceId || roomDeviceUi.microphoneId || activeMicrophoneId;
  const currentOutputId = state.outputDeviceId || roomDeviceUi.outputDeviceId;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const microphones = devices.filter((device) => device.kind === 'audioinput');
  const outputs = devices.filter((device) => device.kind === 'audiooutput');

  roomDeviceUi.microphoneOptions = buildDeviceOptions(microphones, {
    defaultLabel: 'Системный',
    fallbackLabel: 'Микрофон'
  });
  if (currentMicrophoneId && !hasOptionValue(roomDeviceUi.microphoneOptions, currentMicrophoneId)) {
    persistMicrophoneDeviceId('');
    roomDeviceUi.microphoneId = '';
  } else if (hasOptionValue(roomDeviceUi.microphoneOptions, currentMicrophoneId)) {
    roomDeviceUi.microphoneId = currentMicrophoneId;
  }

  roomDeviceUi.outputDisabled = !supportsAudioOutputSelection();
  roomDeviceUi.outputOptions = buildDeviceOptions(outputs, {
    defaultLabel: 'Системный',
    fallbackLabel: 'Динамик'
  });
  if (currentOutputId && !hasOptionValue(roomDeviceUi.outputOptions, currentOutputId)) {
    persistOutputDeviceId('');
    roomDeviceUi.outputDeviceId = '';
  } else if (hasOptionValue(roomDeviceUi.outputOptions, currentOutputId)) {
    roomDeviceUi.outputDeviceId = currentOutputId;
  }

  syncOutputDeviceUiState();
}

function buildDeviceOptions(
  devices: MediaDeviceInfo[],
  options: { defaultLabel: string; fallbackLabel: string }
): SelectOption[] {
  const { defaultLabel, fallbackLabel } = options;
  const renderedDeviceIds = new Set(['']);
  const selectOptions: SelectOption[] = [{ value: '', label: defaultLabel }];

  devices.forEach((device, index) => {
    if (!device.deviceId || renderedDeviceIds.has(device.deviceId)) return;
    renderedDeviceIds.add(device.deviceId);
    selectOptions.push({
      value: device.deviceId,
      label: device.label || `${fallbackLabel} ${index + 1}`
    });
  });

  return selectOptions;
}

function hasOptionValue(options: SelectOption[], value: string): boolean {
  return options.some((option) => option.value === value);
}

function getActiveMicrophoneDeviceId(): string {
  const [track] = (state.localRawStream || state.localStream)?.getAudioTracks() || [];
  return track?.getSettings?.().deviceId || '';
}

interface SwitchMicrophoneOptions {
  failureMessage?: string;
  refreshDeviceList?: boolean;
  successMessage?: string | ((capture: MicrophoneCapture) => string);
}

export async function switchMicrophone(options: SwitchMicrophoneOptions = {}): Promise<boolean> {
  const {
    failureMessage = 'Не удалось переключить микрофон',
    refreshDeviceList = true,
    successMessage = 'Микрофон переключен'
  } = options;
  const previousDeviceId = state.microphoneDeviceId;
  persistMicrophoneDeviceId(roomDeviceUi.microphoneId);
  if (!state.joined || !state.localStream) return false;

  let nextCapture: MicrophoneCapture | null = null;
  try {
    const previousCapture = getLocalMicrophoneCapture();
    nextCapture = await openLocalMicrophone();
    const [nextTrack] = nextCapture.stream?.getAudioTracks() || [];
    if (!nextTrack) throw new Error('Браузер не отдал аудио-трек');

    await unpublishLocalMicrophone(false);
    setLocalMicrophoneCapture(nextCapture);
    await publishLocalMicrophone();
    stopMicrophoneCapture(previousCapture);
    attachMeter(state.self, state.localStream);
    setParticipantSpeaking(state.self, false);
    if (refreshDeviceList) await refreshDevices();
    showToast(typeof successMessage === 'function' ? successMessage(nextCapture) : successMessage);
    return true;
  } catch (error) {
    console.error(error);
    if (nextCapture) stopMicrophoneCapture(nextCapture);
    persistMicrophoneDeviceId(previousDeviceId);
    if (hasOptionValue(roomDeviceUi.microphoneOptions, previousDeviceId)) {
      roomDeviceUi.microphoneId = previousDeviceId;
    }
    showToast(failureMessage);
    return false;
  }
}

export async function switchNoiseMode(): Promise<void> {
  const previousMode = state.noiseMode;
  setNoiseMode(roomDeviceUi.noiseMode);

  if (!state.joined || !state.localStream) return;

  const switched = await switchMicrophone({
    failureMessage: 'Не удалось переключить шумодав',
    refreshDeviceList: false,
    successMessage: (capture) => `Шумодав: ${getNoiseModeLabel(capture.mode)}`
  });
  if (!switched) setNoiseMode(previousMode);
}

export function updateGateThresholdFromSlider(value: string | number): void {
  setGateThresholdDb(value);
  const threshold = getGateThresholdAmplitude();

  window.clearTimeout(gateSwitchTimer);
  if (!state.joined || !state.localStream) return;
  if (updateActiveGateThreshold(threshold)) return;
  if (threshold <= 0) return;

  gateSwitchTimer = window.setTimeout(() => {
    switchMicrophone({
      failureMessage: 'Не удалось применить гейт',
      refreshDeviceList: false,
      successMessage: isGateDisabled() ? 'Гейт выключен' : `Гейт: ${state.gateThresholdDb} dB`
    }).catch((error) => console.error(error));
  }, GATE_CAPTURE_SWITCH_DEBOUNCE_MS);
}

function updateActiveGateThreshold(threshold: number): boolean {
  const gateProcessors = getMicrophoneProcessors(state.micProcessor)
    .filter((processor) => processor.type === 'gate' && typeof processor.setThreshold === 'function');
  if (gateProcessors.length === 0) return false;

  for (const processor of gateProcessors) {
    processor.setThreshold!(threshold);
  }
  return true;
}

export async function switchOutputDevice(): Promise<void> {
  if (!supportsAudioOutputSelection()) {
    roomDeviceUi.outputDeviceId = '';
    persistOutputDeviceId('');
    showToast('Выбор динамика недоступен в этой среде');
    return;
  }

  const previousDeviceId = state.outputDeviceId;
  persistOutputDeviceId(roomDeviceUi.outputDeviceId);
  const synced = await syncAudioOutputDevices();
  if (!synced) {
    persistOutputDeviceId(previousDeviceId);
    if (hasOptionValue(roomDeviceUi.outputOptions, previousDeviceId)) {
      roomDeviceUi.outputDeviceId = previousDeviceId;
    }
    await syncAudioOutputDevices();
    showToast('Не удалось переключить динамик');
    return;
  }

  showToast('Динамик переключен');
}

export function closeDevicePopover(): void {
  roomDeviceUi.devicePopoverOpen = false;
}

export function closeOutputPopover(): void {
  roomDeviceUi.outputPopoverOpen = false;
}