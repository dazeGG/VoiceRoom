import { t } from '@/shared/i18n';
import {
  DEFAULT_GATE_THRESHOLD_DB,
  GATE_CAPTURE_SWITCH_DEBOUNCE_MS,
  GATE_ON_DEFAULT_DB,
  GATE_THRESHOLD_DB_STORAGE_KEY,
  GATE_THRESHOLD_MIN_DB,
  MICROPHONE_DEVICE_STORAGE_KEY,
  OUTPUT_DEVICE_STORAGE_KEY
} from '../core/config';
import type { NoiseMode } from '../core/config';
import type { SelectOption } from '@/shared/ui/Select/types';
import { listPhysicalDevices, withSavedDeviceMissing } from '@/shared/audio/device-list';
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
  isMicrophoneCaptureLive,
  openLocalMicrophone,
  setMicrophoneCaptureEnabled,
  setLocalMicrophoneCapture,
  setNoiseMode,
  stopMicrophoneCapture
} from '../services/microphone-service';
import {
  findLocalMicrophonePublication,
  MicrophonePublicationCleanupError,
  publishLocalMicrophoneForRoom,
  replaceLocalMicrophoneTrackForPublication,
  syncLocalMicrophonePublicationMuted
} from '../services/livekit/local-publications';
import {
  isOutputOnSystemFallback,
  moveAudioOutputToSystem,
  restoreAudioOutput,
  supportsAudioOutputSelection,
  syncAudioOutputDevices
} from '../services/media-playback-service';
import { attachMeter, syncSpeakingThresholds } from '../media/meters';
import { setParticipantSpeaking } from '../room/participants';
import { recordMicDrop } from '../room/call-quality';
import { cancelCaptureProgressObservation, observeCaptureProgress } from '../room/mic-send';
import type { MicrophoneCapture } from '../core/types';
import type { LocalTrackPublication, Room } from 'livekit-client';

import { createLogger, errorContext } from '@/shared/log';

const log = createLogger('room:devices');

let gateSwitchTimer = 0;
let confirmedOutputDeviceId: string | null = null;
let outputSwitchGeneration = 0;
const MIC_ACTION_TIMEOUT_MS = 10_000;
export type MicrophoneActionOutcome = 'applied' | 'failed' | 'stale' | 'timed_out' | 'busy' | 'coalesced';
let captureSlot: Promise<unknown> | null = null;
let mutationSlot: Promise<unknown> | null = null;
let pendingPublishRoom: Room | null = null;
/** A timed-out republish of the committed track, still pending in its room. */
let lateRepublish: { slot: Promise<unknown>; room: Room } | null = null;
let currentAction = false;
let actionVersion = 0;
let pendingJoinCapture: MicrophoneCapture | null = null;
let callGeneration = 0;
let automaticAttempts = 0;
let processorFallbacks = 0;
let effectiveNoiseMode: NoiseMode | null = null;
let manualDeviceBaseline: string | null = null;
let manualNoiseBaseline: NoiseMode | null = null;
let pendingManual: { run: () => Promise<boolean>; resolve: (applied: boolean) => void; timer: number } | null = null;
let pendingRawLoss: { capture: MicrophoneCapture; generation: number; room: Room | null } | null = null;
let rawLossInFlight = false;
export type MicrophoneRecoveryReason = 'watchdog' | 'raw_ended' | 'owned_resume_failure' | 'processorerror';
export interface MicrophoneRecoveryEvent {
  generation: number;
  attempt: number;
  reason: MicrophoneRecoveryReason;
  action: 'reopen' | 'replace' | 'browser_fallback';
  outcome: 'applied' | 'failed' | 'stale' | 'timed_out';
  durationMs: number;
  actualMode: NoiseMode | null;
  progress: 'capture_progress_restored' | 'unverified' | 'not_applied';
  evidence: 'encoder_feed' | 'none';
}
let recoveryObserver: ((event: MicrophoneRecoveryEvent) => void) | null = null;
interface AutomaticAdmission {
  attempt: number;
  startedAt: number;
  generation: number;
  reason: MicrophoneRecoveryReason;
  action: MicrophoneRecoveryEvent['action'];
  settled: boolean;
}
const pendingAutomatic = new Set<AutomaticAdmission>();

export function setMicrophoneRecoveryObserver(observer: ((event: MicrophoneRecoveryEvent) => void) | null): void {
  recoveryObserver = observer;
}

export function startMicrophoneCall(): void {
  callGeneration += 1;
  automaticAttempts = 0;
  processorFallbacks = 0;
  effectiveNoiseMode = null;
  reconsiderFailedCurrentProcessor();
}

function reconsiderFailedCurrentProcessor(): void {
  const capture = getLocalMicrophoneCapture();
  if (!capture.processorFailed || capture.mode !== 'rnnoise' || state.localStream !== capture.stream || pendingManual)
    return;
  if (canAdmitAutomaticMicrophoneAction()) fallbackRnnoiseAfterProcessorError(capture);
}

function drainManualIntent(): void {
  if (currentAction || captureSlot || mutationSlot) return;
  if (!pendingManual) {
    if (reconsiderEndedCurrentMicrophone()) return;
    reconsiderFailedCurrentProcessor();
    return;
  }
  const pending = pendingManual;
  pendingManual = null;
  window.clearTimeout(pending.timer);
  void pending.run().then(pending.resolve, () => pending.resolve(false));
}

function settleManualPreferences(outcome: MicrophoneActionOutcome, version: number): void {
  if (version !== actionVersion) return;
  if (outcome !== 'applied' && outcome !== 'stale') {
    if (manualDeviceBaseline !== null) {
      persistMicrophoneDeviceId(manualDeviceBaseline);
      useRoomDeviceUiStore().microphoneId = listedOrSystem(
        useRoomDeviceUiStore().microphoneOptions,
        manualDeviceBaseline
      );
    }
    if (manualNoiseBaseline !== null) setNoiseMode(manualNoiseBaseline);
  }
  manualDeviceBaseline = null;
  manualNoiseBaseline = null;
}

function acceptCommittedPreferences(): void {
  manualDeviceBaseline = null;
  manualNoiseBaseline = null;
}

function queueManualIntent(run: () => Promise<boolean>): Promise<boolean> {
  actionVersion += 1;
  if (pendingManual) {
    window.clearTimeout(pendingManual.timer);
    pendingManual.resolve(false);
  }
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      if (pendingManual?.resolve !== resolve) return;
      pendingManual = null;
      resolve(false);
    }, MIC_ACTION_TIMEOUT_MS * 2);
    pendingManual = { run, resolve, timer };
    queueMicrotask(drainManualIntent);
  });
}

export function getMicrophoneCallGeneration(): number {
  return callGeneration;
}

/** Conservative revision: manual intents, automatic mutations and invalidation all fence a prepared room handover. */
export function getMicrophoneIntentRevision(): number {
  return actionVersion;
}

/** SDK publish events may precede promise resolution; only the owner commits state. */
export function isOwnedMicrophonePublishPending(room: Room): boolean {
  return pendingPublishRoom === room && mutationSlot !== null;
}

export function canAdmitAutomaticMicrophoneAction(): boolean {
  return (
    state.joined &&
    !state.muted &&
    !state.outputMuted &&
    automaticAttempts < 6 &&
    !currentAction &&
    !captureSlot &&
    !mutationSlot
  );
}

function admitAutomatic(
  reason: MicrophoneRecoveryReason,
  action: MicrophoneRecoveryEvent['action']
): {
  attempt: number;
  startedAt: number;
  generation: number;
  reason: MicrophoneRecoveryReason;
  action: MicrophoneRecoveryEvent['action'];
  settled: boolean;
} | null {
  if (!canAdmitAutomaticMicrophoneAction()) return null;
  automaticAttempts += 1;
  const admission = {
    attempt: automaticAttempts,
    generation: callGeneration,
    reason,
    action,
    startedAt: performance.now(),
    settled: false
  };
  pendingAutomatic.add(admission);
  return admission;
}

function emitAutomatic(admission: AutomaticAdmission, event: MicrophoneRecoveryEvent): void {
  if (admission.settled) return;
  admission.settled = true;
  pendingAutomatic.delete(admission);
  recoveryObserver?.(event);
}

function finishAutomatic(
  admission: NonNullable<ReturnType<typeof admitAutomatic>>,
  outcome: MicrophoneActionOutcome
): void {
  if (admission.settled) return;
  if (outcome === 'busy' || outcome === 'coalesced') {
    pendingAutomatic.delete(admission);
    automaticAttempts -= 1;
    return;
  }
  const event: MicrophoneRecoveryEvent = {
    generation: admission.generation,
    attempt: admission.attempt,
    reason: admission.reason,
    action: admission.action,
    outcome,
    durationMs: Math.max(0, Math.round(performance.now() - admission.startedAt)),
    actualMode: getLocalMicrophoneCapture().mode ?? null,
    progress: outcome === 'applied' ? 'unverified' : 'not_applied',
    evidence: 'none'
  };
  if (outcome !== 'applied') {
    emitAutomatic(admission, event);
    return;
  }
  const appliedStream = state.localStream;
  const appliedPublication = state.localMicPublication;
  observeCaptureProgress(
    (restored) => {
      emitAutomatic(admission, {
        ...event,
        progress: restored ? 'capture_progress_restored' : 'unverified',
        evidence: restored ? 'encoder_feed' : 'none'
      });
    },
    () => state.localStream === appliedStream && state.localMicPublication === appliedPublication
  );
}
let deviceChangeTimer = 0;
let outputLossAnnounced = false;
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
    thresholdLabel: isGateDisabled() ? t('Выкл') : `${state.gateThresholdDb} dB`,
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
 * is back, and the call returns to it on its own. The speaker menu names a
 * missing saved device instead, so that the system entry can make the move final.
 */
export async function refreshDevices(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];

  const devices = await navigator.mediaDevices.enumerateDevices();
  const microphones = listPhysicalDevices(devices, 'audioinput');
  const outputs = listPhysicalDevices(devices, 'audiooutput');
  const cameras = listPhysicalDevices(devices, 'videoinput');

  useRoomDeviceUiStore().microphoneOptions = buildDeviceOptions(microphones, {
    defaultLabel: t('Системный'),
    fallbackLabel: t('Микрофон')
  });
  useRoomDeviceUiStore().microphoneId = listedOrSystem(
    useRoomDeviceUiStore().microphoneOptions,
    state.microphoneDeviceId
  );

  useRoomDeviceUiStore().outputDisabled = !supportsAudioOutputSelection();
  useRoomDeviceUiStore().outputOptions = withSavedDeviceMissing(
    buildDeviceOptions(outputs, { defaultLabel: t('Системный'), fallbackLabel: t('Динамик') }),
    state.outputDeviceId
  );
  useRoomDeviceUiStore().outputDeviceId = listedOrSystem(useRoomDeviceUiStore().outputOptions, state.outputDeviceId);
  if (useRoomDeviceUiStore().outputDeviceId === state.outputDeviceId) confirmedOutputDeviceId = state.outputDeviceId;

  useRoomDeviceUiStore().cameraOptions = buildDeviceOptions(cameras, {
    defaultLabel: t('Системная'),
    fallbackLabel: t('Камера')
  });
  useRoomDeviceUiStore().cameraId = listedOrSystem(useRoomDeviceUiStore().cameraOptions, state.cameraDeviceId);

  syncOutputDeviceUiStateSoon();
  // Not awaited: entering a room must not wait for an audio device to answer.
  followPreferredOutput(devices).catch((error: unknown) =>
    log.warn('output device follow failed', errorContext(error))
  );
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
 * While the saved speaker is gone the sound plays on the system device, and the
 * saved choice is selected again when it returns. No ids: the browser hides them,
 * so nothing can be said about the saved speaker yet.
 */
async function followPreferredOutput(devices: MediaDeviceInfo[]): Promise<void> {
  const outputs = listedDevices(devices, 'audiooutput');
  if (outputs.length === 0 || !supportsAudioOutputSelection()) return;
  const preferred = state.outputDeviceId;
  if (!preferred || outputs.some((device) => device.deviceId === preferred)) {
    outputLossAnnounced = false;
    if (preferred && isOutputOnSystemFallback()) await restoreAudioOutput();
    return;
  }

  await moveAudioOutputToSystem();
  if (outputLossAnnounced) return;
  outputLossAnnounced = true;
  showToast(t('Динамик недоступен, звук идёт через системный'));
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
  modeOverride?: NoiseMode;
  /** Said when the failed action also cost the call its microphone. */
  lostMessage?: string;
}

/** The user picked a microphone in the dock: save it and move the call to it. */
export async function switchMicrophone(options: SwitchMicrophoneOptions = {}): Promise<boolean> {
  manualDeviceBaseline ??= state.microphoneDeviceId;
  persistMicrophoneDeviceId(useRoomDeviceUiStore().microphoneId);
  if (currentAction || captureSlot || mutationSlot) {
    return queueManualIntent(() => performMicrophoneSwitch(options));
  }
  return performMicrophoneSwitch(options);
}

async function performMicrophoneSwitch(options: SwitchMicrophoneOptions): Promise<boolean> {
  if (state.joined && !state.localStream) {
    const attaching = attachMicrophone();
    const version = actionVersion;
    const attached = await attaching;
    if (attached) await syncMicrophoneControlsSoon({ unmute: true });
    settleManualPreferences(attached ? 'applied' : 'failed', version);
    return attached;
  }
  if (!state.joined || !state.localStream) {
    settleManualPreferences('stale', actionVersion);
    return false;
  }

  const action = replaceMicrophoneCapture(options, true);
  const version = actionVersion;
  try {
    const outcome = await action;
    settleManualPreferences(outcome, version);
    return outcome === 'applied';
  } finally {
    currentAction = false;
    drainManualIntent();
  }
}

/**
 * Reopens the capture with the current device and processing settings. Runs
 * one at a time: two overlapping switches would both replace the same capture
 * and leave one of the new ones recording in the background.
 */
function restartMicrophone(options: SwitchMicrophoneOptions = {}): Promise<boolean> {
  return replaceMicrophoneCapture(options).then((outcome) => outcome === 'applied');
}

/**
 * Leave invalidates logical ownership and ends the quarantine of the room being
 * left: a publication that could not be detached goes with its disconnected room,
 * so it must not keep the next call without a microphone. A late result of an
 * old slot still cleans up after itself and cannot clear a newer slot.
 */
export function invalidateMicrophoneActions(): void {
  actionVersion += 1;
  captureSlot = null;
  mutationSlot = null;
  pendingPublishRoom = null;
  lateRepublish = null;
  if (pendingManual) {
    window.clearTimeout(pendingManual.timer);
    pendingManual.resolve(false);
    pendingManual = null;
  }
  effectiveNoiseMode = null;
  pendingRawLoss = null;
  manualDeviceBaseline = null;
  manualNoiseBaseline = null;
  disposePendingJoinCapture();
  cancelCaptureProgressObservation();
  for (const admission of pendingAutomatic) {
    emitAutomatic(admission, {
      generation: admission.generation,
      attempt: admission.attempt,
      reason: admission.reason,
      action: admission.action,
      outcome: 'stale',
      durationMs: Math.max(0, Math.round(performance.now() - admission.startedAt)),
      actualMode: getLocalMicrophoneCapture().mode ?? null,
      progress: 'not_applied',
      evidence: 'none'
    });
  }
}

function clearPendingJoinCapture(capture: MicrophoneCapture): void {
  if (pendingJoinCapture !== capture) return;
  pendingJoinCapture = null;
}

function disposePendingJoinCapture(): void {
  const capture = pendingJoinCapture;
  if (!capture) return;
  clearPendingJoinCapture(capture);
  setMicrophoneCaptureEnabled(capture, false);
  stopMicrophoneCapture(capture);
}

export function disposePreparedMicrophoneForJoin(capture: MicrophoneCapture): void {
  if (pendingJoinCapture === capture) disposePendingJoinCapture();
  else if (state.localStream !== capture.stream) stopMicrophoneCapture(capture);
}

function timedPhase<T>(work: Promise<T>, remainingMs: number): Promise<{ value: T } | { timeout: true }> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => resolve({ timeout: true }), Math.max(0, remainingMs));
    void work.then(
      (value) => {
        window.clearTimeout(timer);
        resolve({ value });
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error('Microphone action failed', { cause: error }));
      }
    );
  });
}

/** One unresolved browser acquisition/preparation, even after its logical deadline. */
async function acquireCandidate(
  isCurrent: () => boolean,
  deadline: number,
  mode?: NoiseMode
): Promise<MicrophoneCapture | 'timed_out'> {
  let abandoned = false;
  const work = openLocalMicrophone(() => !abandoned && isCurrent(), mode ?? effectiveNoiseMode ?? undefined);
  const slot = work.then((capture) => {
    if (abandoned) stopMicrophoneCapture(capture);
  });
  captureSlot = slot;
  void slot
    .catch(() => {})
    .finally(() => {
      if (captureSlot === slot) captureSlot = null;
      drainManualIntent();
    });
  try {
    const result = await timedPhase(work, deadline - performance.now());
    if ('timeout' in result) {
      abandoned = true;
      return 'timed_out';
    }
    return result.value;
  } catch (error) {
    abandoned = true;
    throw error;
  }
}

/** Join may listen without a mic when an old page-wide slot is still unresolved. */
export async function acquireMicrophoneForJoin(
  isCurrent: () => boolean,
  onTimeout?: () => void,
  onBusy?: () => void
): Promise<MicrophoneCapture | null> {
  if (captureSlot || mutationSlot || currentAction || pendingJoinCapture) {
    log.warn('joining without a microphone: an earlier microphone operation is unresolved');
    if (isCurrent()) onBusy?.();
    return null;
  }
  currentAction = true;
  const deadline = performance.now() + MIC_ACTION_TIMEOUT_MS;
  try {
    const candidate = await acquireCandidate(isCurrent, deadline);
    if (candidate === 'timed_out') {
      if (isCurrent()) onTimeout?.();
      return null;
    }
    if (!isCurrent() || !isMicrophoneCaptureLive(candidate)) {
      stopMicrophoneCapture(candidate);
      return null;
    }
    pendingJoinCapture = candidate;
    return candidate;
  } finally {
    currentAction = false;
  }
}

export async function publishMicrophoneForJoin(
  room: Room,
  capture: MicrophoneCapture,
  isCurrent: () => boolean
): Promise<{ outcome: MicrophoneActionOutcome; publication: LocalTrackPublication | null }> {
  if (mutationSlot) return { outcome: 'busy', publication: null };
  if (pendingJoinCapture !== capture || !isCurrent()) return { outcome: 'stale', publication: null };
  if (!isMicrophoneCaptureLive(capture)) {
    disposePendingJoinCapture();
    return { outcome: 'failed', publication: null };
  }
  const result = await mutateCandidate(
    room,
    null,
    capture,
    () => pendingJoinCapture === capture && isCurrent() && isMicrophoneCaptureLive(capture),
    performance.now() + MIC_ACTION_TIMEOUT_MS
  );
  // Only this join's capture: a newer join may have prepared its own meanwhile.
  if (result.outcome === 'applied') clearPendingJoinCapture(capture);
  else if (pendingJoinCapture === capture) disposePendingJoinCapture();
  return result.outcome === 'applied' && result.publication
    ? { outcome: 'applied', publication: result.publication }
    : { outcome: result.outcome === 'applied' ? 'failed' : result.outcome, publication: null };
}

/** A raw source can end in the microtask between publication and join commit. Keep its cleanup under the SDK owner. */
export function discardPublishedJoinMicrophone(
  room: Room,
  publication: LocalTrackPublication,
  capture: MicrophoneCapture
): Promise<void> {
  setMicrophoneCaptureEnabled(capture, false);
  const previous = mutationSlot;
  let cleanupFailed = false;
  const work = Promise.resolve(previous).then(async () => {
    const track = publication.track ?? capture.stream?.getAudioTracks()[0];
    if (!track) throw new Error('Published microphone has no track');
    await room.localParticipant.unpublishTrack(track, false);
  });
  mutationSlot = work;
  void work
    .catch((error: unknown) => {
      cleanupFailed = true;
      log.warn('late join microphone cleanup failed', errorContext(error));
    })
    .finally(() => {
      if (mutationSlot === work && !cleanupFailed) {
        mutationSlot = null;
        if (pendingPublishRoom === room) pendingPublishRoom = null;
      }
      drainManualIntent();
    });
  return timedPhase(work, MIC_ACTION_TIMEOUT_MS).then(
    (result) => {
      if ('timeout' in result)
        throw new MicrophonePublicationCleanupError('Ended join microphone publication cleanup timed out');
    },
    (error: unknown) => {
      throw new MicrophonePublicationCleanupError('Ended join microphone publication cleanup failed', { cause: error });
    }
  );
}

/** In-place LiveKit reconnect uses the same page-wide mutation owner as device actions. */
export async function ensureCurrentMicrophonePublication(expectedRoom?: Room): Promise<MicrophoneActionOutcome> {
  const room = state.livekitRoom;
  if (!room || (expectedRoom && room !== expectedRoom)) return 'stale';
  const stream = state.localStream;
  const publication = findLocalMicrophonePublication();
  if (publication) {
    state.localMicPublication = publication;
    await syncLocalMicrophonePublicationMuted();
    return 'applied';
  }
  if (mutationSlot || captureSlot) return 'busy';
  if (currentAction) return 'coalesced';
  if (!stream) return 'stale';
  currentAction = true;
  const version = actionVersion;
  const isCurrent = () =>
    version === actionVersion && state.livekitRoom === room && state.localStream === stream && state.joined;
  try {
    const result = await mutateCandidate(
      room,
      null,
      getLocalMicrophoneCapture(),
      isCurrent,
      performance.now() + MIC_ACTION_TIMEOUT_MS,
      { republishCommitted: true }
    );
    if (result.outcome === 'applied' && result.publication && isCurrent()) {
      state.localMicPublication = result.publication;
    }
    return result.outcome;
  } finally {
    currentAction = false;
  }
}

/**
 * The room could not take the committed microphone back and no new connection
 * carried it: the call goes on listen-only, said so, instead of a live microphone
 * button nobody hears. Leaves it alone while another owner is still working on it.
 */
export function dropUnpublishedMicrophone(message: string): boolean {
  if (!state.joined || !state.localStream || state.localMicPublication) return false;
  if (currentAction || captureSlot || mutationSlot) return false;
  const capture = getLocalMicrophoneCapture();
  setMicrophoneCaptureEnabled(capture, false);
  stopMicrophoneCapture(capture);
  state.localStream = null;
  state.localRawStream = null;
  state.micProcessor = null;
  state.microphoneMissing = true;
  refreshMicrophoneLevelMeter(GATE_THRESHOLD_MIN_DB);
  void syncMicrophoneControlsSoon().catch((error: unknown) =>
    log.warn('microphone controls refresh failed', errorContext(error))
  );
  showToast(message, { duration: 8000 });
  return true;
}

/** A candidate LiveKit room may publish the committed track only under the same mutation slot. */
export async function publishMicrophoneForReplacementRoom(
  room: Room,
  stream: MediaStream,
  isCurrent: () => boolean
): Promise<{ outcome: MicrophoneActionOutcome; publication: LocalTrackPublication | null }> {
  // The standing room may still be publishing the same committed track. The
  // candidate supersedes it: once the candidate commits, the standing room's late
  // publication is no longer current and is detached by its own slot.
  const supersedes = lateRepublish !== null && mutationSlot === lateRepublish.slot && lateRepublish.room !== room;
  if ((mutationSlot && !supersedes) || captureSlot || currentAction) return { outcome: 'busy', publication: null };
  const capture = getLocalMicrophoneCapture();
  if (capture.stream !== stream || !isCurrent() || !isMicrophoneCaptureLive(capture))
    return { outcome: 'stale', publication: null };
  // Released only now, right before mutateCandidate takes the slot synchronously.
  if (supersedes) {
    mutationSlot = null;
    lateRepublish = null;
  }
  return mutateCandidate(room, null, capture, isCurrent, performance.now() + MIC_ACTION_TIMEOUT_MS);
}

/**
 * In the call without a microphone: open one now and publish it. It arrives
 * muted; the microphone button unmutes it when the user asked for it. An
 * automatic attempt (a device was plugged in) stays quiet when there is still
 * none.
 */
export function attachMicrophone(options: { automatic?: boolean } = {}): Promise<boolean> {
  return attachMicrophoneOutcome(options).then((outcome) => outcome === 'applied');
}

const ATTACH_TIMED_OUT_MESSAGE = 'Микрофон не ответил вовремя: попробуйте ещё раз';

export async function attachMicrophoneOutcome(options: { automatic?: boolean } = {}): Promise<MicrophoneActionOutcome> {
  if (!state.joined || state.localStream) return 'stale';
  if (currentAction) return 'coalesced';
  if (captureSlot || mutationSlot) {
    if (!options.automatic) showToast(t('Микрофон ещё занят прошлой операцией: попробуйте через несколько секунд'));
    return 'busy';
  }
  currentAction = true;
  const version = ++actionVersion;
  const room = state.livekitRoom;
  const isCurrent = () => version === actionVersion && state.joined && state.livekitRoom === room && !state.localStream;
  const deadline = performance.now() + MIC_ACTION_TIMEOUT_MS;
  let capture: MicrophoneCapture | null = null;
  try {
    const acquired = await acquireCandidate(isCurrent, deadline);
    if (acquired === 'timed_out') {
      if (!options.automatic && version === actionVersion) showToast(t(ATTACH_TIMED_OUT_MESSAGE));
      return 'timed_out';
    }
    capture = acquired;
    if (!isCurrent()) return 'stale';
    if (!room) return 'stale';
    state.muted = true;
    const result = await mutateCandidate(room, null, capture, isCurrent, deadline);
    if (result.outcome !== 'applied' || !result.publication) {
      if (!options.automatic && version === actionVersion) {
        if (result.outcome === 'timed_out') showToast(t(ATTACH_TIMED_OUT_MESSAGE));
        if (result.outcome === 'failed') showToast(t('Не удалось подключить микрофон'));
      }
      return result.outcome;
    }
    state.microphoneMissing = false;
    state.localMicPublication = result.publication;
    setLocalMicrophoneCapture(capture);
    acceptCommittedPreferences();
    watchLocalMicrophone();
    attachMeter(state.self, state.localStream);
    void refreshDevices().catch((error: unknown) => log.warn('device list failed', errorContext(error)));
    showToast(options.automatic ? t('Микрофон найден: включите его кнопкой микрофона') : t('Микрофон подключен'));
    return 'applied';
  } catch (error) {
    // A left call or a newer choice made this attempt obsolete: nothing to report.
    if (!isCurrent()) return 'stale';
    log.warn('microphone still unavailable', errorContext(error));
    if (!options.automatic) showToast(describeMicrophoneError(error));
    return 'failed';
  } finally {
    if (capture && state.localStream !== capture.stream) stopMicrophoneCapture(capture);
    currentAction = false;
    drainManualIntent();
  }
}

async function mutateCandidate(
  room: Room,
  publication: LocalTrackPublication | null,
  capture: MicrophoneCapture,
  isCurrent: () => boolean,
  deadline: number,
  /**
   * The capture is the committed microphone being published again after an
   * in-place reconnect. A slow SDK publish then leaves it live and adopts the
   * late publication while it is still current, instead of dropping the call
   * to listen-only.
   */
  { republishCommitted = false }: { republishCommitted?: boolean } = {}
): Promise<{ outcome: MicrophoneActionOutcome; publication: LocalTrackPublication | null }> {
  if (mutationSlot) return { outcome: 'busy', publication: null };
  if (performance.now() >= deadline) return { outcome: 'timed_out', publication: null };
  const [track] = capture.stream?.getAudioTracks() || [];
  const candidateCurrent = () => isCurrent() && isMicrophoneCaptureLive(capture);
  if (!track || !candidateCurrent())
    return { outcome: isCurrent() && !isMicrophoneCaptureLive(capture) ? 'failed' : 'stale', publication: null };
  const previousCapture = publication ? getLocalMicrophoneCapture() : null;
  const previousTrack = previousCapture?.stream?.getAudioTracks()[0];
  const previousStream = state.localStream;
  const previousRawStream = state.localRawStream;
  const previousProcessor = state.micProcessor;
  const ownsPrevious = () =>
    previousCapture &&
    state.joined &&
    state.livekitRoom === room &&
    state.localMicPublication === publication &&
    state.localStream === previousStream &&
    state.localRawStream === previousRawStream &&
    state.micProcessor === previousProcessor;
  let abandoned = false;
  let adoptLate = false;
  let cleanupFailed = false;
  const work: Promise<LocalTrackPublication | null> = publication?.track
    ? replaceLocalMicrophoneTrackForPublication(room, publication, track, () => !abandoned && candidateCurrent()).then(
        (replaced) => (replaced ? publication : null)
      )
    : publishLocalMicrophoneForRoom(room, capture.stream, () => !abandoned && candidateCurrent(), false);
  if (!publication?.track) pendingPublishRoom = room;
  const cleanupPublication = async (result: LocalTrackPublication) => {
    try {
      await room.localParticipant.unpublishTrack(result.track ?? track, false);
    } catch (error) {
      cleanupFailed = true;
      throw error;
    }
    if (state.localMicPublication === result) state.localMicPublication = null;
  };
  const slot = work.then(
    async (result) => {
      if (adoptLate && result && !abandoned && candidateCurrent()) {
        if (!state.localMicPublication) state.localMicPublication = result;
        return;
      }
      if ((!abandoned && candidateCurrent()) || !result) return;
      if (publication && result === publication) {
        // A stale preference invalidates commit, not the previous live owner.
        // Keep the mutation slot through rollback so no newer action can race it.
        if (ownsPrevious() && previousTrack) {
          setMicrophoneCaptureEnabled(capture, false);
          try {
            if (publication.track?.mediaStreamTrack !== previousTrack)
              await publication.track?.replaceTrack(previousTrack, true);
            if (ownsPrevious()) return;
          } catch (error) {
            log.warn('microphone rollback failed', errorContext(error));
            if (ownsPrevious()) {
              setMicrophoneCaptureEnabled(previousCapture, false);
              stopMicrophoneCapture(previousCapture);
              state.localStream = null;
              state.localRawStream = null;
              state.micProcessor = null;
              state.localMicPublication = null;
              state.microphoneMissing = true;
            }
          }
        }
        if (state.localMicPublication === publication && state.localStream !== previousStream) return;
      }
      // A late publish or obsolete room owner cannot commit.
      await cleanupPublication(result);
    },
    async (error: unknown) => {
      if (error instanceof MicrophonePublicationCleanupError) {
        cleanupFailed = true;
        if (abandoned || adoptLate) log.warn('late microphone cleanup failed', errorContext(error));
      }
      if (publication && !abandoned && (!previousTrack || publication.track?.mediaStreamTrack !== previousTrack)) {
        // LiveKit can install the new MediaStreamTrack before a later sender step
        // rejects. Only exact old-track identity proves the former capture is safe.
        setMicrophoneCaptureEnabled(capture, false);
        if (previousCapture) setMicrophoneCaptureEnabled(previousCapture, false);
        // A newer preference can invalidate the action token while this exact
        // publication and capture still own the room. Cleanup follows resource
        // identity, not permission to commit the obsolete action.
        if (
          previousCapture &&
          state.joined &&
          state.livekitRoom === room &&
          state.localMicPublication === publication &&
          state.localStream === previousStream &&
          state.localRawStream === previousRawStream &&
          state.micProcessor === previousProcessor
        ) {
          stopMicrophoneCapture(previousCapture);
          state.localStream = null;
          state.localRawStream = null;
          state.micProcessor = null;
          state.localMicPublication = null;
          state.microphoneMissing = true;
        }
        await cleanupPublication(publication);
      } else if (abandoned && publication) {
        await cleanupPublication(publication);
      }
    }
  );
  mutationSlot = slot;
  void slot
    .catch((error: unknown) => log.warn('late microphone cleanup failed', errorContext(error)))
    .finally(() => {
      if (lateRepublish?.slot === slot) lateRepublish = null;
      if (mutationSlot === slot && !cleanupFailed) {
        mutationSlot = null;
        if (pendingPublishRoom === room) pendingPublishRoom = null;
      }
      drainManualIntent();
    });
  try {
    const result = await timedPhase(work, deadline - performance.now());
    if ('timeout' in result) {
      if (republishCommitted && !publication) {
        // Only the committed track can be attached: keep it live for the late publish.
        adoptLate = true;
        if (mutationSlot === slot) lateRepublish = { slot, room };
        return { outcome: 'timed_out', publication: null };
      }
      abandoned = true;
      // A candidate that is not the committed microphone can carry nothing yet.
      if (capture.stream !== state.localStream) setMicrophoneCaptureEnabled(capture, false);
      // Only a track replace can have swapped the committed microphone, and only
      // while this action still owns it: the SDK may have attached either track,
      // so silence both. A publish leaves the committed microphone alone, which
      // may belong to a newer call or carry the current room.
      if (previousCapture && ownsPrevious()) {
        setMicrophoneCaptureEnabled(previousCapture, false);
        stopMicrophoneCapture(previousCapture);
        state.localStream = null;
        state.localRawStream = null;
        state.micProcessor = null;
        state.localMicPublication = null;
        state.microphoneMissing = true;
      }
      return { outcome: 'timed_out', publication: null };
    }
    if (!candidateCurrent()) {
      abandoned = true;
      return { outcome: isCurrent() && !isMicrophoneCaptureLive(capture) ? 'failed' : 'stale', publication: null };
    }
    return { outcome: result.value ? 'applied' : 'failed', publication: result.value };
  } catch (error) {
    if (error instanceof MicrophonePublicationCleanupError) {
      setMicrophoneCaptureEnabled(capture, false);
      if (state.localStream === capture.stream) {
        stopMicrophoneCapture(capture);
        state.localStream = null;
        state.localRawStream = null;
        state.micProcessor = null;
        state.localMicPublication = null;
        state.microphoneMissing = true;
      }
    }
    log.error('microphone publication failed', errorContext(error));
    return { outcome: 'failed', publication: null };
  }
}

function ownsRawLoss(loss: NonNullable<typeof pendingRawLoss>): boolean {
  return (
    loss.generation === callGeneration &&
    state.joined &&
    state.livekitRoom === loss.room &&
    state.localStream === loss.capture.stream &&
    state.localRawStream === loss.capture.rawStream
  );
}

/** A terminal raw source is reevaluated only after the preceding manual owner settles its preferences. */
function reconsiderEndedCurrentMicrophone(): boolean {
  const loss = pendingRawLoss;
  if (!loss) return false;
  if (!ownsRawLoss(loss) || isMicrophoneCaptureLive(loss.capture)) {
    pendingRawLoss = null;
    return false;
  }
  if (rawLossInFlight) return true;
  rawLossInFlight = true;
  if (canAdmitAutomaticMicrophoneAction()) {
    void runAutomaticReopen('raw_ended', {
      failureMessage: t('Микрофон отключился: вы в комнате без микрофона'),
      lostMessage: t('Микрофон отключился: вы в комнате без микрофона'),
      successMessage: t('Микрофон переподключен')
    }).then(() => {
      rawLossInFlight = false;
      if (!ownsRawLoss(loss)) {
        if (pendingRawLoss === loss) pendingRawLoss = null;
        drainManualIntent();
        return;
      }
      if (currentAction || captureSlot || mutationSlot) return;
      detachEndedMicrophone(loss);
    });
  } else {
    rawLossInFlight = false;
    detachEndedMicrophone(loss);
  }
  return true;
}

/** Quarantine exact old publication before presenting the call as listen-only. */
function detachEndedMicrophone(loss: NonNullable<typeof pendingRawLoss>): void {
  if (!ownsRawLoss(loss) || mutationSlot || captureSlot || currentAction) return;
  if (pendingRawLoss === loss) pendingRawLoss = null;
  const publication = state.localMicPublication;
  const room = loss.room;
  setMicrophoneCaptureEnabled(loss.capture, false);
  state.microphoneMissing = true;
  let cleanupFailed = false;
  const work = Promise.resolve().then(async () => {
    const track = publication?.track;
    if (room && track) await room.localParticipant.unpublishTrack(track, false);
    // LiveKit emits LocalTrackUnpublished before its promise settles; null is
    // the expected result for this exact old publication, not a new owner.
    if (!ownsRawLoss(loss) || (state.localMicPublication !== publication && state.localMicPublication !== null)) return;
    stopMicrophoneCapture(loss.capture);
    state.localStream = null;
    state.localRawStream = null;
    state.micProcessor = null;
    state.localMicPublication = null;
    refreshMicrophoneLevelMeter(GATE_THRESHOLD_MIN_DB);
    void syncMicrophoneControlsSoon().catch((error: unknown) =>
      log.warn('microphone controls refresh failed', errorContext(error))
    );
  });
  mutationSlot = work;
  void work
    .catch((error: unknown) => {
      cleanupFailed = true;
      log.warn('microphone unpublish failed', errorContext(error));
    })
    .finally(() => {
      if (mutationSlot === work && !cleanupFailed) mutationSlot = null;
      drainManualIntent();
    });
}

/**
 * A failed replace either left the call microphone in place or cost the call its
 * microphone. A loss is always said, even when a newer choice made this action
 * obsolete: that choice cannot apply to a microphone that is gone. A plain failure
 * of an obsolete action says nothing.
 */
function reportUnappliedReplacement(
  previousStream: MediaStream | null,
  failureMessage: string,
  lostMessage: string,
  current: boolean
): void {
  if (!previousStream || !state.joined || state.localStream) {
    if (current) showToast(failureMessage);
    return;
  }
  refreshMicrophoneLevelMeter(GATE_THRESHOLD_MIN_DB);
  void syncMicrophoneControlsSoon().catch((error: unknown) =>
    log.warn('microphone controls refresh failed', errorContext(error))
  );
  showToast(lostMessage, { duration: 8000 });
}

async function replaceMicrophoneCapture(
  options: SwitchMicrophoneOptions,
  retainManualOwner = false
): Promise<MicrophoneActionOutcome> {
  const {
    failureMessage = t('Не удалось переключить микрофон'),
    refreshDeviceList = true,
    successMessage = t('Микрофон переключен'),
    lostMessage = t('{p0}: вы в комнате без микрофона', { p0: failureMessage })
  } = options;
  if (!state.joined || !state.localStream) return 'stale';
  if (currentAction) return 'coalesced';
  if (captureSlot || mutationSlot) return 'busy';
  currentAction = true;
  const version = ++actionVersion;
  const room = state.livekitRoom;
  const publication = state.localMicPublication;
  const deadline = performance.now() + MIC_ACTION_TIMEOUT_MS;

  const previousCapture = getLocalMicrophoneCapture();
  let nextCapture: MicrophoneCapture | null = null;
  const isCurrent = () =>
    version === actionVersion &&
    state.joined &&
    state.livekitRoom === room &&
    state.localMicPublication === publication &&
    state.localStream === previousCapture.stream;
  try {
    const acquired = await acquireCandidate(isCurrent, deadline, options.modeOverride);
    if (acquired === 'timed_out') {
      if (version === actionVersion) showToast(failureMessage);
      return 'timed_out';
    }
    nextCapture = acquired;
    if (!isCurrent() || !room) return 'stale';
    const result = await mutateCandidate(room, publication, nextCapture, isCurrent, deadline);
    if (result.outcome !== 'applied' || !result.publication) {
      if (result.outcome === 'failed' || result.outcome === 'timed_out')
        reportUnappliedReplacement(previousCapture.stream, failureMessage, lostMessage, version === actionVersion);
      return result.outcome;
    }

    state.localMicPublication = result.publication;
    setLocalMicrophoneCapture(nextCapture);
    acceptCommittedPreferences();
    watchLocalMicrophone();
    stopMicrophoneCapture(previousCapture);
    attachMeter(state.self, state.localStream);
    setParticipantSpeaking(state.self, false);
    if (refreshDeviceList)
      void refreshDevices().catch((error: unknown) => log.warn('device list failed', errorContext(error)));
    showToast(typeof successMessage === 'function' ? successMessage(nextCapture) : successMessage);
    return 'applied';
  } catch (error) {
    if (!isCurrent()) return 'stale';
    log.error('device action failed', errorContext(error));
    showToast(failureMessage);
    return 'failed';
  } finally {
    if (nextCapture && state.localStream !== nextCapture.stream) stopMicrophoneCapture(nextCapture);
    if (!retainManualOwner) {
      currentAction = false;
      drainManualIntent();
    }
  }
}

/**
 * An unplugged or revoked microphone ends its track, while the processed track
 * the call publishes goes on carrying silence. Reopen the capture at once: the
 * saved device if it is still there, the system one if not.
 */
export function watchLocalMicrophone(): void {
  const rawStream = state.localRawStream;
  const [track] = rawStream?.getAudioTracks() || [];
  const capture = getLocalMicrophoneCapture();
  capture.removeRawEndedListener?.();
  const onEnded = () => {
    if (state.localRawStream !== rawStream || state.localStream !== capture.stream) return;
    log.warn('microphone track ended');
    recordMicDrop();
    pendingRawLoss = { capture, generation: callGeneration, room: state.livekitRoom };
    drainManualIntent();
  };
  track?.addEventListener('ended', onEnded, { once: true });
  if (track) capture.removeRawEndedListener = () => track.removeEventListener('ended', onEnded);
  if (track?.readyState === 'ended') onEnded();
}

/** The capture stopped running on its own (see microphone-service): open a fresh one. */
export function reopenMicrophone(): Promise<boolean> {
  recordMicDrop();
  return runAutomaticReopen('watchdog', {
    failureMessage: t('Микрофон перестал работать: выберите его заново'),
    lostMessage: t('Микрофон перестал работать: вы в комнате без микрофона'),
    refreshDeviceList: false,
    successMessage: t('Микрофон переподключен')
  });
}

async function runAutomaticReopen(
  reason: MicrophoneRecoveryReason,
  options: SwitchMicrophoneOptions
): Promise<boolean> {
  const admission = admitAutomatic(reason, reason === 'processorerror' ? 'browser_fallback' : 'reopen');
  if (!admission) return false;
  const outcome = await replaceMicrophoneCapture(options);
  finishAutomatic(admission, outcome);
  return outcome === 'applied';
}

export function reopenMicrophoneAfterOwnedResumeFailure(): Promise<boolean> {
  return runAutomaticReopen('owned_resume_failure', {
    failureMessage: t('Микрофон перестал работать: выберите его заново'),
    lostMessage: t('Микрофон перестал работать: вы в комнате без микрофона'),
    refreshDeviceList: false,
    successMessage: t('Микрофон переподключен')
  });
}

export function fallbackRnnoiseAfterProcessorError(capture: MicrophoneCapture): void {
  if (state.localStream !== capture.stream || capture.mode !== 'rnnoise' || processorFallbacks >= 1) return;
  const admission = admitAutomatic('processorerror', 'browser_fallback');
  if (!admission) return;
  processorFallbacks += 1;
  void replaceMicrophoneCapture({
    failureMessage: t('Не удалось включить браузерный шумодав'),
    refreshDeviceList: false,
    successMessage: t('RNNoise остановился: включён браузерный шумодав'),
    modeOverride: 'browser'
  }).then((outcome) => {
    if (
      outcome === 'applied' &&
      admission.generation === callGeneration &&
      state.joined &&
      getLocalMicrophoneCapture().mode === 'browser'
    )
      effectiveNoiseMode = 'browser';
    finishAutomatic(admission, outcome);
  });
}

export function requestAutomaticMicrophoneConnectionReplacement(
  replace: () => Promise<boolean> | null,
  abandonOnTimeout: (request: Promise<boolean>) => void = () => {}
): Promise<boolean> | null {
  const admission = admitAutomatic('watchdog', 'replace');
  if (!admission) return null;
  const work = replace();
  if (!work) {
    automaticAttempts -= 1;
    pendingAutomatic.delete(admission);
    return null;
  }
  return timedPhase(work, MIC_ACTION_TIMEOUT_MS).then(
    (result) => {
      if ('timeout' in result) {
        abandonOnTimeout(work);
        finishAutomatic(admission, 'timed_out');
        return false;
      }
      finishAutomatic(admission, result.value ? 'applied' : 'failed');
      return result.value;
    },
    (error: unknown) => {
      finishAutomatic(admission, 'failed');
      throw error;
    }
  );
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
    failureMessage: t('Не удалось включить облегчённый шумодав'),
    refreshDeviceList: false,
    successMessage: t('Компьютер перегружен: включён облегчённый шумодав')
  });
  if (!switched && state.noiseMode === 'browser') {
    state.noiseMode = 'rnnoise';
    useRoomDeviceUiStore().noiseMode = 'rnnoise';
  }
  return switched;
}

export async function switchNoiseMode(): Promise<void> {
  manualNoiseBaseline ??= state.noiseMode;
  setNoiseMode(useRoomDeviceUiStore().noiseMode);
  effectiveNoiseMode = null;
  if (currentAction || captureSlot || mutationSlot) {
    await queueManualIntent(performNoiseSwitch);
    return;
  }

  await performNoiseSwitch();
}

async function performNoiseSwitch(): Promise<boolean> {
  if (!state.joined || !state.localStream) {
    settleManualPreferences('stale', actionVersion);
    return false;
  }

  const action = replaceMicrophoneCapture(
    {
      failureMessage: t('Не удалось переключить шумодав'),
      refreshDeviceList: false,
      successMessage: (capture) => t('Шумодав: {p0}', { p0: getNoiseModeLabel(capture.mode) })
    },
    true
  );
  const version = actionVersion;
  try {
    const outcome = await action;
    settleManualPreferences(outcome, version);
    return outcome === 'applied';
  } finally {
    currentAction = false;
    drainManualIntent();
  }
}

export function updateGateThresholdFromSlider(value: string | number): void {
  setGateThresholdDb(value);
  const threshold = getGateThresholdAmplitude();

  window.clearTimeout(gateSwitchTimer);
  if (!state.joined || !state.localStream) return;
  if (updateActiveGateThreshold(state.pushToTalkActive ? 0 : threshold)) return;
  if (threshold <= 0) return;

  gateSwitchTimer = window.setTimeout(() => {
    const options = {
      failureMessage: t('Не удалось применить гейт'),
      refreshDeviceList: false,
      successMessage: isGateDisabled() ? t('Гейт выключен') : t('Гейт: {p0} dB', { p0: state.gateThresholdDb })
    };
    const action =
      currentAction || captureSlot || mutationSlot
        ? queueManualIntent(() => performGateSwitch(options))
        : performGateSwitch(options);
    action.catch((error: unknown) => log.error('device action failed', errorContext(error)));
  }, GATE_CAPTURE_SWITCH_DEBOUNCE_MS);
}

async function performGateSwitch(options: SwitchMicrophoneOptions): Promise<boolean> {
  if (!state.joined || !state.localStream) return false;
  const action = replaceMicrophoneCapture(options, true);
  const version = actionVersion;
  try {
    const outcome = await action;
    settleManualPreferences(outcome, version);
    return outcome === 'applied';
  } finally {
    currentAction = false;
    drainManualIntent();
  }
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
    showToast(t('Выбор динамика недоступен в этой среде'));
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
    await restoreAudioOutput();
    showToast(t('Не удалось переключить динамик'));
    return;
  }

  confirmedOutputDeviceId = requestedDeviceId;
  showToast(t('Динамик переключен'));
  // The entry of a device that is gone has served its purpose: drop it from the menu.
  refreshDevices().catch((error: unknown) => log.warn('device list refresh failed', errorContext(error)));
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
