import {
  DEFAULT_GATE_THRESHOLD_DB,
  GATE_CAPTURE_SWITCH_DEBOUNCE_MS,
  GATE_THRESHOLD_DB_STORAGE_KEY,
  GATE_THRESHOLD_MAX_DB,
  GATE_THRESHOLD_MIN_DB,
  MICROPHONE_DEVICE_STORAGE_KEY,
  OUTPUT_DEVICE_STORAGE_KEY,
  OUTPUT_MUTED_STORAGE_KEY
} from '../core/config';
import { elements } from './dom';
import { state } from '../core/state';
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
import { refreshCallControls, refreshOutputControls } from './controls';
import type { MicrophoneCapture } from '../core/types';

let gateSwitchTimer = 0;

export function clearGateSwitchTimer(): void {
  window.clearTimeout(gateSwitchTimer);
  gateSwitchTimer = 0;
}

export function setGateThresholdDb(value: string | number): void {
  const threshold = Number.parseInt(String(value), 10);
  state.gateThresholdDb = Number.isFinite(threshold) ? clampGateThresholdDb(threshold) : DEFAULT_GATE_THRESHOLD_DB;
  elements.gateThresholdSlider.value = String(state.gateThresholdDb);
  localStorage.setItem(GATE_THRESHOLD_DB_STORAGE_KEY, String(state.gateThresholdDb));
  refreshGateThresholdValue();
}

export function refreshGateThresholdValue(): void {
  elements.gateThresholdValue.textContent = isGateDisabled() ? 'Выкл' : `${state.gateThresholdDb} dB`;
  refreshGateMarker();
}

function refreshGateMarker(): void {
  if (!elements.micGateMarker) return;

  const position = getDbMeterPosition(state.gateThresholdDb);
  elements.micGateMarker.style.left = `${(position * 100).toFixed(2)}%`;
  elements.micGateMarker.dataset.active = String(!isGateDisabled());
}

export function refreshMicrophoneLevelMeter(db: number): void {
  if (!elements.micLevelFill || !elements.micLevelTrack) return;

  const levelDb = Number.isFinite(db) ? clampGateThresholdDb(db) : GATE_THRESHOLD_MIN_DB;
  const position = getDbMeterPosition(levelDb);
  const gateOpen = isGateDisabled() || levelDb >= state.gateThresholdDb;
  elements.micLevelFill.style.transform = `scaleX(${position.toFixed(3)})`;
  elements.micLevelFill.dataset.state = gateOpen ? 'open' : 'closed';
  elements.micLevelTrack.setAttribute('aria-valuenow', String(Math.round(levelDb)));
  refreshGateMarker();
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
  const currentMicrophoneId = state.microphoneDeviceId || elements.deviceSelect.value || activeMicrophoneId;
  const currentOutputId = state.outputDeviceId || elements.outputDeviceSelect.value;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const microphones = devices.filter((device) => device.kind === 'audioinput');
  const outputs = devices.filter((device) => device.kind === 'audiooutput');

  renderDeviceOptions(elements.deviceSelect, microphones, {
    defaultLabel: 'Системный',
    fallbackLabel: 'Микрофон',
    selectedId: currentMicrophoneId
  });
  if (currentMicrophoneId && !hasSelectValue(elements.deviceSelect, currentMicrophoneId)) {
    persistMicrophoneDeviceId('');
  } else if (hasSelectValue(elements.deviceSelect, currentMicrophoneId)) {
    elements.deviceSelect.value = currentMicrophoneId;
  }

  elements.outputDeviceSelect.disabled = !supportsAudioOutputSelection();
  renderDeviceOptions(elements.outputDeviceSelect, outputs, {
    defaultLabel: 'Системный',
    fallbackLabel: 'Динамик',
    selectedId: currentOutputId
  });
  if (currentOutputId && !hasSelectValue(elements.outputDeviceSelect, currentOutputId)) {
    persistOutputDeviceId('');
  } else if (hasSelectValue(elements.outputDeviceSelect, currentOutputId)) {
    elements.outputDeviceSelect.value = currentOutputId;
  }

  refreshOutputControls();
}

function renderDeviceOptions(
  select: HTMLSelectElement,
  devices: MediaDeviceInfo[],
  options: { defaultLabel: string; fallbackLabel: string; selectedId: string }
): void {
  const { defaultLabel, fallbackLabel, selectedId } = options;
  const renderedDeviceIds = new Set(['']);
  select.textContent = '';

  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = defaultLabel;
  select.append(defaultOption);

  devices.forEach((device, index) => {
    if (!device.deviceId || renderedDeviceIds.has(device.deviceId)) return;
    renderedDeviceIds.add(device.deviceId);
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || `${fallbackLabel} ${index + 1}`;
    select.append(option);
  });

  select.value = hasSelectValue(select, selectedId) ? selectedId : '';
}

function hasSelectValue(select: HTMLSelectElement, value: string): boolean {
  return [...select.options].some((option) => option.value === value);
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
  persistMicrophoneDeviceId(elements.deviceSelect.value);
  refreshCallControls();
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
    if (hasSelectValue(elements.deviceSelect, previousDeviceId)) {
      elements.deviceSelect.value = previousDeviceId;
    }
    showToast(failureMessage);
    return false;
  }
}

export async function switchNoiseMode(): Promise<void> {
  const previousMode = state.noiseMode;
  setNoiseMode(elements.noiseModeSelect.value);

  if (!state.joined || !state.localStream) return;

  const switched = await switchMicrophone({
    failureMessage: 'Не удалось переключить шумодав',
    refreshDeviceList: false,
    successMessage: (capture) => `Шумодав: ${getNoiseModeLabel(capture.mode)}`
  });
  if (!switched) setNoiseMode(previousMode);
}

export function updateGateThresholdFromSlider(): void {
  setGateThresholdDb(elements.gateThresholdSlider.value);
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

export function handleGateThresholdPointerDown(event: PointerEvent): void {
  event.preventDefault();
  updateGateThresholdFromPointer(event);
  elements.micLevelTrack.setPointerCapture?.(event.pointerId);
  elements.micLevelTrack.addEventListener('pointermove', handleGateThresholdPointerMove);
  elements.micLevelTrack.addEventListener('pointerup', handleGateThresholdPointerEnd, { once: true });
  elements.micLevelTrack.addEventListener('pointercancel', handleGateThresholdPointerEnd, { once: true });
}

function handleGateThresholdPointerMove(event: PointerEvent): void {
  updateGateThresholdFromPointer(event);
}

function handleGateThresholdPointerEnd(event: PointerEvent): void {
  elements.micLevelTrack.releasePointerCapture?.(event.pointerId);
  elements.micLevelTrack.removeEventListener('pointermove', handleGateThresholdPointerMove);
}

function updateGateThresholdFromPointer(event: PointerEvent): void {
  const rect = elements.micLevelTrack.getBoundingClientRect();
  if (rect.width <= 0) return;

  const position = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  const value = Math.round(GATE_THRESHOLD_MIN_DB + position * (GATE_THRESHOLD_MAX_DB - GATE_THRESHOLD_MIN_DB));
  elements.gateThresholdSlider.value = String(value);
  updateGateThresholdFromSlider();
}

export async function switchOutputDevice(): Promise<void> {
  if (!supportsAudioOutputSelection()) {
    elements.outputDeviceSelect.value = '';
    persistOutputDeviceId('');
    showToast('Выбор динамика недоступен в этой среде');
    return;
  }

  const previousDeviceId = state.outputDeviceId;
  persistOutputDeviceId(elements.outputDeviceSelect.value);
  const synced = await syncAudioOutputDevices();
  if (!synced) {
    persistOutputDeviceId(previousDeviceId);
    if (hasSelectValue(elements.outputDeviceSelect, previousDeviceId)) {
      elements.outputDeviceSelect.value = previousDeviceId;
    }
    await syncAudioOutputDevices();
    showToast('Не удалось переключить динамик');
    return;
  }

  showToast('Динамик переключен');
}

export function toggleDevicePopover(event: MouseEvent): void {
  event.stopPropagation();
  closeOutputPopover();
  const willOpen = elements.devicePopover.hidden;
  elements.devicePopover.hidden = !willOpen;
  elements.deviceMenuButton.setAttribute('aria-expanded', String(willOpen));
  if (willOpen) refreshDevices().catch(() => {});
}

export function closeDevicePopover(): void {
  elements.devicePopover.hidden = true;
  elements.deviceMenuButton.setAttribute('aria-expanded', 'false');
}

export function closeDevicePopoverOnOutside(event: MouseEvent): void {
  if (elements.devicePopover.hidden) return;
  const target = event.target as Node;
  if (elements.devicePopover.contains(target) || elements.deviceMenuButton.contains(target)) return;
  closeDevicePopover();
}

export function closeDevicePopoverOnEscape(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeDevicePopover();
}

export function toggleOutputPopover(event: MouseEvent): void {
  event.stopPropagation();
  closeDevicePopover();
  const willOpen = elements.outputPopover.hidden;
  elements.outputPopover.hidden = !willOpen;
  elements.outputMenuButton.setAttribute('aria-expanded', String(willOpen));
  if (willOpen) refreshDevices().catch(() => {});
}

export function closeOutputPopover(): void {
  elements.outputPopover.hidden = true;
  elements.outputMenuButton.setAttribute('aria-expanded', 'false');
}

export function closeOutputPopoverOnOutside(event: MouseEvent): void {
  if (elements.outputPopover.hidden) return;
  const target = event.target as Node;
  if (elements.outputPopover.contains(target) || elements.outputMenuButton.contains(target)) return;
  closeOutputPopover();
}

export function closeOutputPopoverOnEscape(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeOutputPopover();
}
