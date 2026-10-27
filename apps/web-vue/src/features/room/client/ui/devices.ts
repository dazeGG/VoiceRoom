import {
  DEFAULT_GATE_THRESHOLD_DB,
  GATE_CAPTURE_SWITCH_DEBOUNCE_MS,
  GATE_ON_DEFAULT_DB,
  GATE_THRESHOLD_DB_STORAGE_KEY,
  GATE_THRESHOLD_MIN_DB,
  MICROPHONE_DEVICE_STORAGE_KEY,
  OUTPUT_DEVICE_STORAGE_KEY
} from '../core/config';
import type { SelectOption } from '@/shared/ui/Select/types';
import { listPhysicalDevices } from '@/shared/audio/device-list';
import { removeStorage, writeStorage } from '@/shared/storage';
import { useRoomDeviceUiStore } from '@/features/room/room-device-ui.store';
import { state } from '../core/room-runtime.store';
import { clampGateThresholdDb, getDbMeterPosition, getNoiseModeLabel } from '../core/settings';
import { showToast } from './toast';
import {
  describeMicrophoneError,
  getGateThresholdAmplitude,
  getLocalMicrophoneCapture,
  getMicrophoneProcessors,
  isGateDisabled,
  openLocalMicrophone,
  setLocalMicrophoneCapture,
  setNoiseMode,
  stopMicrophoneCapture
} from '../services/microphone-service';
import {
  publishLocalMicrophone,
  replaceLocalMicrophoneTrack,
  unpublishLocalMicrophone
} from '../services/livekit-service';
import { supportsAudioOutputSelection, syncAudioOutputDevices } from '../services/media-playback-service';
import { attachMeter, syncSpeakingThresholds } from '../media/meters';
import { setParticipantSpeaking } from '../room/participants';
import { recordMicDrop } from '../room/call-quality';
import type { MicrophoneCapture } from '../core/types';

import { createLogger, errorContext } from '@/shared/log';

const log = createLogger('room:devices');

let gateSwitchTimer = 0;
let confirmedOutputDeviceId: string | null = null;
let outputSwitchGeneration = 0;
let microphoneTasks: Promise<unknown> = Promise.resolve();
let deviceChangeTimer = 0;
let preferredOutputPresent = true;
const DEVICE_CHANGE_SETTLE_MS = 400;
// Remembers the last non-off threshold so toggling the gate back on restores it,
// mirroring SettingsModal's local gateDb/gateOn split.
let lastGateThresholdDb = GATE_ON_DEFAULT_DB;

export interface GateControlView {
  levelScale: number;
  levelState: 'open' | 'closed';
  markerActive: boolean;
  thresholdLabel: string;
  thresholdValue: number;
  gateOn: boolean;
}

export function getGateControlView(): GateControlView {
  const levelDb = Number.isFinite(useRoomDeviceUiStore().micLevelDb)
    ? clampGateThresholdDb(useRoomDeviceUiStore().micLevelDb)
    : GATE_THRESHOLD_MIN_DB;
  const position = getDbMeterPosition(levelDb);
  const gateOpen = isGateDisabled() || levelDb >= state.gateThresholdDb;

  return {
    levelScale: position,
    levelState: gateOpen ? 'open' : 'closed',
    markerActive: !isGateDisabled(),
    thresholdLabel: isGateDisabled() ? 'Выкл' : `${state.gateThresholdDb} dB`,
    thresholdValue: state.gateThresholdDb,
    gateOn: !isGateDisabled()
  };
}

export function toggleGate(): void {
  if (isGateDisabled()) {
    updateGateThresholdFromSlider(lastGateThresholdDb);
  } else {
    lastGateThresholdDb = state.gateThresholdDb;
    updateGateThresholdFromSlider(GATE_THRESHOLD_MIN_DB);
  }
}

export function clearGateSwitchTimer(): void {
  window.clearTimeout(gateSwitchTimer);
  gateSwitchTimer = 0;
}

function setGateThresholdDb(value: string | number): void {
  const threshold = Number.parseInt(String(value), 10);
  state.gateThresholdDb = Number.isFinite(threshold) ? clampGateThresholdDb(threshold) : DEFAULT_GATE_THRESHOLD_DB;
  writeStorage(GATE_THRESHOLD_DB_STORAGE_KEY, String(state.gateThresholdDb));
  // The own ring lights at the gate's threshold, so the detector follows it.
  syncSpeakingThresholds();
}

export function refreshMicrophoneLevelMeter(db: number): void {
  useRoomDeviceUiStore().micLevelDb = Number.isFinite(db) ? clampGateThresholdDb(db) : GATE_THRESHOLD_MIN_DB;
}

function persistMicrophoneDeviceId(deviceId: string): void {
  state.microphoneDeviceId = deviceId || '';
  if (state.microphoneDeviceId) {
    writeStorage(MICROPHONE_DEVICE_STORAGE_KEY, state.microphoneDeviceId);
  } else {
    removeStorage(MICROPHONE_DEVICE_STORAGE_KEY);
  }
}

function persistOutputDeviceId(deviceId: string): void {
  state.outputDeviceId = deviceId || '';
  if (state.outputDeviceId) {
    writeStorage(OUTPUT_DEVICE_STORAGE_KEY, state.outputDeviceId);
  } else {
    removeStorage(OUTPUT_DEVICE_STORAGE_KEY);
  }
}

async function syncMicrophoneControlsSoon(options: { unmute?: boolean } = {}): Promise<void> {
  const { syncMicrophoneControls } = await import('./controls');
  syncMicrophoneControls(options);
}

function syncOutputDeviceUiStateSoon(): void {
  void import('./controls').then((module) => module.syncOutputDeviceUiState());
}

/**
 * Rebuilds the device menus. A saved device missing from the list (unplugged,
 * a Bluetooth headset asleep, or ids the browser hides until the microphone is
 * allowed) keeps its saved choice: the menu shows the system device until it
 * is back, and the call returns to it on its own.
 */
export async function refreshDevices(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];

  const devices = await navigator.mediaDevices.enumerateDevices();
  const microphones = listPhysicalDevices(devices, 'audioinput');
  const outputs = listPhysicalDevices(devices, 'audiooutput');
  const cameras = listPhysicalDevices(devices, 'videoinput');

  useRoomDeviceUiStore().microphoneOptions = buildDeviceOptions(microphones, {
    defaultLabel: 'Системный',
    fallbackLabel: 'Микрофон'
  });
  useRoomDeviceUiStore().microphoneId = listedOrSystem(
    useRoomDeviceUiStore().microphoneOptions,
    state.microphoneDeviceId
  );

  useRoomDeviceUiStore().outputDisabled = !supportsAudioOutputSelection();
  useRoomDeviceUiStore().outputOptions = buildDeviceOptions(outputs, {
    defaultLabel: 'Системный',
    fallbackLabel: 'Динамик'
  });
  useRoomDeviceUiStore().outputDeviceId = listedOrSystem(useRoomDeviceUiStore().outputOptions, state.outputDeviceId);
  if (useRoomDeviceUiStore().outputDeviceId === state.outputDeviceId) confirmedOutputDeviceId = state.outputDeviceId;

  useRoomDeviceUiStore().cameraOptions = buildDeviceOptions(cameras, {
    defaultLabel: 'Системная',
    fallbackLabel: 'Камера'
  });
  useRoomDeviceUiStore().cameraId = listedOrSystem(useRoomDeviceUiStore().cameraOptions, state.cameraDeviceId);

  syncOutputDeviceUiStateSoon();
  return devices;
}

function listedOrSystem(options: SelectOption[], deviceId: string): string {
  return deviceId && hasOptionValue(options, deviceId) ? deviceId : '';
}

/**
 * devicechange fires several times for one plug (a headset brings an input and
 * an output), so the reaction waits for the list to settle.
 */
export function handleDeviceChange(): void {
  window.clearTimeout(deviceChangeTimer);
  deviceChangeTimer = window.setTimeout(() => {
    deviceChangeTimer = 0;
    followDeviceChange().catch((error: unknown) => log.warn('device change handling failed', errorContext(error)));
  }, DEVICE_CHANGE_SETTLE_MS);
}

async function followDeviceChange(): Promise<void> {
  const devices = await refreshDevices();
  if (state.joined && !state.localStream && listedDevices(devices, 'audioinput').length > 0) {
    if (await attachMicrophone({ automatic: true })) await syncMicrophoneControlsSoon();
  } else if (shouldReopenMicrophone(devices)) {
    await restartMicrophone({ refreshDeviceList: false });
  }
  await followPreferredOutput(devices);
}

function listedDevices(devices: MediaDeviceInfo[], kind: MediaDeviceKind): MediaDeviceInfo[] {
  return devices.filter((device) => device.kind === kind && device.deviceId);
}

/**
 * The capture is reopened when its device is gone, when the saved microphone
 * is plugged back in, or when the system default moves to another device:
 * Chrome keeps capturing the old one after the OS default changes.
 */
function shouldReopenMicrophone(devices: MediaDeviceInfo[]): boolean {
  if (!state.joined || !state.localStream) return false;
  // No ids: the browser hides them, or there is no microphone to reopen.
  const microphones = listedDevices(devices, 'audioinput');
  if (microphones.length === 0) return false;

  const track = getActiveMicrophoneTrack();
  if (!track || track.readyState === 'ended') return true;

  const settings = track.getSettings?.() || {};
  const preferred = state.microphoneDeviceId;
  if (preferred && preferred !== 'default' && microphones.some((device) => device.deviceId === preferred)) {
    return Boolean(settings.deviceId) && settings.deviceId !== preferred;
  }
  const systemDefault = microphones.find((device) => device.deviceId === 'default');
  return Boolean(systemDefault?.groupId && settings.groupId && systemDefault.groupId !== settings.groupId);
}

/**
 * A missing saved output stays fail-closed (see audio-output-transition), so
 * the sound comes back only when that device returns: re-select it then.
 */
async function followPreferredOutput(devices: MediaDeviceInfo[]): Promise<void> {
  const outputs = listedDevices(devices, 'audiooutput');
  if (outputs.length === 0 || !supportsAudioOutputSelection()) return;
  const preferred = state.outputDeviceId;
  const present = !preferred || outputs.some((device) => device.deviceId === preferred);
  const returned = present && !preferredOutputPresent;
  preferredOutputPresent = present;
  if (returned && preferred) await syncAudioOutputDevices();
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

function getActiveMicrophoneTrack(): MediaStreamTrack | null {
  const [track] = (state.localRawStream || state.localStream)?.getAudioTracks() || [];
  return track || null;
}

interface SwitchMicrophoneOptions {
  failureMessage?: string;
  refreshDeviceList?: boolean;
  successMessage?: string | ((capture: MicrophoneCapture) => string);
}

/** The user picked a microphone in the dock: save it and move the call to it. */
export async function switchMicrophone(options: SwitchMicrophoneOptions = {}): Promise<boolean> {
  const previousDeviceId = state.microphoneDeviceId;
  persistMicrophoneDeviceId(useRoomDeviceUiStore().microphoneId);
  if (state.joined && !state.localStream) {
    const attached = await attachMicrophone();
    if (attached) await syncMicrophoneControlsSoon({ unmute: true });
    return attached;
  }
  if (!state.joined || !state.localStream) return false;

  const switched = await restartMicrophone(options);
  if (!switched) {
    persistMicrophoneDeviceId(previousDeviceId);
    useRoomDeviceUiStore().microphoneId = listedOrSystem(useRoomDeviceUiStore().microphoneOptions, previousDeviceId);
  }
  return switched;
}

/**
 * Reopens the capture with the current device and processing settings. Runs
 * one at a time: two overlapping switches would both replace the same capture
 * and leave one of the new ones recording in the background.
 */
function restartMicrophone(options: SwitchMicrophoneOptions = {}): Promise<boolean> {
  return queueMicrophoneTask(() => replaceMicrophoneCapture(options));
}

function queueMicrophoneTask(task: () => Promise<boolean>): Promise<boolean> {
  const run = microphoneTasks.then(task, task);
  microphoneTasks = run.catch(() => false);
  return run;
}

/**
 * In the call without a microphone: open one now and publish it. It arrives
 * muted; the microphone button unmutes it when the user asked for it. An
 * automatic attempt (a device was plugged in) stays quiet when there is still
 * none.
 */
export function attachMicrophone(options: { automatic?: boolean } = {}): Promise<boolean> {
  return queueMicrophoneTask(async () => {
    if (!state.joined || state.localStream) return false;
    let capture: MicrophoneCapture;
    try {
      capture = await openLocalMicrophone();
    } catch (error) {
      log.warn('microphone still unavailable', errorContext(error));
      if (!options.automatic) showToast(describeMicrophoneError(error));
      return false;
    }
    if (!state.joined || state.localStream) {
      stopMicrophoneCapture(capture);
      return false;
    }

    state.muted = true;
    state.microphoneMissing = false;
    setLocalMicrophoneCapture(capture);
    watchLocalMicrophone();
    await publishLocalMicrophone().catch((error: unknown) =>
      log.warn('microphone publish failed', errorContext(error))
    );
    attachMeter(state.self, state.localStream);
    await refreshDevices().catch((error: unknown) => log.warn('device list failed', errorContext(error)));
    showToast(options.automatic ? 'Микрофон найден: включите его кнопкой микрофона' : 'Микрофон подключен');
    return true;
  });
}

/** The microphone is gone and none can replace it: stay in the call to listen. */
async function detachMicrophone(): Promise<void> {
  const capture = getLocalMicrophoneCapture();
  await unpublishLocalMicrophone(false).catch((error: unknown) =>
    log.warn('microphone unpublish failed', errorContext(error))
  );
  stopMicrophoneCapture(capture);
  state.localStream = null;
  state.localRawStream = null;
  state.micProcessor = null;
  state.microphoneMissing = true;
  refreshMicrophoneLevelMeter(GATE_THRESHOLD_MIN_DB);
}

async function replaceMicrophoneCapture(options: SwitchMicrophoneOptions): Promise<boolean> {
  const {
    failureMessage = 'Не удалось переключить микрофон',
    refreshDeviceList = true,
    successMessage = 'Микрофон переключен'
  } = options;
  if (!state.joined || !state.localStream) return false;

  const previousCapture = getLocalMicrophoneCapture();
  let nextCapture: MicrophoneCapture | null = null;
  let replaced: boolean;
  try {
    nextCapture = await openLocalMicrophone();
    if (state.localStream !== previousCapture.stream) {
      // The call was left or rejoined while the microphone opened.
      stopMicrophoneCapture(nextCapture);
      return false;
    }
    const [nextTrack] = nextCapture.stream?.getAudioTracks() || [];
    if (!nextTrack) throw new Error('Браузер не отдал аудио-трек');

    // Swapping the track under the publication keeps every listener
    // subscribed; unpublishing first cut the voice off for a moment.
    replaced = await replaceLocalMicrophoneTrack(nextTrack);
  } catch (error) {
    log.error('device action failed', errorContext(error));
    if (nextCapture) stopMicrophoneCapture(nextCapture);
    showToast(failureMessage);
    return false;
  }

  setLocalMicrophoneCapture(nextCapture);
  watchLocalMicrophone();
  stopMicrophoneCapture(previousCapture);
  if (!replaced) {
    // Nothing published yet; a reconnect publishes whatever capture is current.
    await publishLocalMicrophone().catch((error: unknown) =>
      log.warn('microphone publish failed', errorContext(error))
    );
  }
  attachMeter(state.self, state.localStream);
  setParticipantSpeaking(state.self, false);
  if (refreshDeviceList)
    await refreshDevices().catch((error: unknown) => log.warn('device list failed', errorContext(error)));
  showToast(typeof successMessage === 'function' ? successMessage(nextCapture) : successMessage);
  return true;
}

/**
 * An unplugged or revoked microphone ends its track, while the processed track
 * the call publishes goes on carrying silence. Reopen the capture at once: the
 * saved device if it is still there, the system one if not.
 */
export function watchLocalMicrophone(): void {
  const rawStream = state.localRawStream;
  const [track] = rawStream?.getAudioTracks() || [];
  track?.addEventListener(
    'ended',
    () => {
      if (state.localRawStream !== rawStream) return;
      log.warn('microphone track ended');
      recordMicDrop();
      void restartMicrophone({
        failureMessage: 'Микрофон отключился: вы в комнате без микрофона',
        successMessage: 'Микрофон переподключен'
      }).then(async (restarted) => {
        if (restarted || state.localRawStream !== rawStream) return;
        await detachMicrophone();
        await syncMicrophoneControlsSoon();
      });
    },
    { once: true }
  );
}

/** The capture stopped running on its own (see microphone-service): open a fresh one. */
export function reopenMicrophone(): Promise<boolean> {
  recordMicDrop();
  return restartMicrophone({
    failureMessage: 'Микрофон перестал работать: выберите его заново',
    refreshDeviceList: false,
    successMessage: 'Микрофон переподключен'
  });
}

/**
 * The computer is straining the call (see call-strain.ts). Like Discord turning Krisp
 * off, RNNoise gives way to the browser's own noise suppression, which costs
 * next to nothing. Only for this call: the saved choice stays RNNoise, so the
 * next call starts with it again.
 */
export async function relieveNoiseSuppression(): Promise<boolean> {
  if (!state.joined || !state.localStream || state.noiseMode !== 'rnnoise') return false;
  state.noiseMode = 'browser';
  useRoomDeviceUiStore().noiseMode = 'browser';
  const switched = await restartMicrophone({
    failureMessage: 'Не удалось включить облегчённый шумодав',
    refreshDeviceList: false,
    successMessage: 'Компьютер перегружен: включён облегчённый шумодав'
  });
  if (!switched && state.noiseMode === 'browser') {
    state.noiseMode = 'rnnoise';
    useRoomDeviceUiStore().noiseMode = 'rnnoise';
  }
  return switched;
}

export async function switchNoiseMode(): Promise<void> {
  const previousMode = state.noiseMode;
  setNoiseMode(useRoomDeviceUiStore().noiseMode);

  if (!state.joined || !state.localStream) return;

  const switched = await restartMicrophone({
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
  if (updateActiveGateThreshold(state.pushToTalkActive ? 0 : threshold)) return;
  if (threshold <= 0) return;

  gateSwitchTimer = window.setTimeout(() => {
    restartMicrophone({
      failureMessage: 'Не удалось применить гейт',
      refreshDeviceList: false,
      successMessage: isGateDisabled() ? 'Гейт выключен' : `Гейт: ${state.gateThresholdDb} dB`
    }).catch((error: unknown) => log.error('device action failed', errorContext(error)));
  }, GATE_CAPTURE_SWITCH_DEBOUNCE_MS);
}

function updateActiveGateThreshold(threshold: number): boolean {
  let applied = false;
  for (const processor of getMicrophoneProcessors(state.micProcessor)) {
    if (processor.type !== 'gate') continue;
    processor.setThreshold(threshold);
    applied = true;
  }
  return applied;
}

export async function switchOutputDevice(): Promise<void> {
  if (!supportsAudioOutputSelection()) {
    useRoomDeviceUiStore().outputDeviceId = '';
    persistOutputDeviceId('');
    showToast('Выбор динамика недоступен в этой среде');
    return;
  }

  const generation = ++outputSwitchGeneration;
  confirmedOutputDeviceId ??= state.outputDeviceId;
  const requestedDeviceId = useRoomDeviceUiStore().outputDeviceId;
  persistOutputDeviceId(requestedDeviceId);
  const synced = await syncAudioOutputDevices();
  if (generation !== outputSwitchGeneration) return;
  if (!synced) {
    persistOutputDeviceId(confirmedOutputDeviceId);
    if (hasOptionValue(useRoomDeviceUiStore().outputOptions, confirmedOutputDeviceId)) {
      useRoomDeviceUiStore().outputDeviceId = confirmedOutputDeviceId;
    }
    await syncAudioOutputDevices();
    showToast('Не удалось переключить динамик');
    return;
  }

  confirmedOutputDeviceId = requestedDeviceId;
  preferredOutputPresent = true;
  showToast('Динамик переключен');
}

export function closeDevicePopover(): void {
  useRoomDeviceUiStore().devicePopoverOpen = false;
}

export function closeOutputPopover(): void {
  useRoomDeviceUiStore().outputPopoverOpen = false;
}

export function closeCameraPopover(): void {
  useRoomDeviceUiStore().cameraPopoverOpen = false;
}
