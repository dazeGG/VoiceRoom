import {
  DEFAULT_GATE_THRESHOLD_DB,
  DEFAULT_MASTER_VOLUME,
  DEFAULT_MICROPHONE_MODE,
  DEFAULT_MICROPHONE_VOLUME,
  DEFAULT_NOISE_MODE,
  DEFAULT_NOTIFICATION_VOLUME,
  DEFAULT_PARTICIPANT_VOLUME,
  DEFAULT_STREAM_VOLUME,
  GATE_THRESHOLD_DB_STORAGE_KEY,
  GATE_THRESHOLD_MAX_DB,
  GATE_THRESHOLD_MIN_DB,
  MASTER_VOLUME_STORAGE_KEY,
  MAX_MASTER_VOLUME,
  MAX_MICROPHONE_VOLUME,
  MAX_NOTIFICATION_VOLUME,
  MAX_PARTICIPANT_VOLUME,
  MAX_STREAM_VOLUME,
  NOISE_MODES,
  NOISE_MODE_STORAGE_KEY,
  MICROPHONE_MODE_STORAGE_KEY,
  MICROPHONE_VOLUME_STORAGE_KEY,
  NOTIFICATION_VOLUME_STORAGE_KEY,
  OUTPUT_MUTED_STORAGE_KEY,
  PARTICIPANT_AUDIO_PREFERENCES_STORAGE_KEY,
  PREVIOUS_GATE_MAX_AMPLITUDE,
  PREVIOUS_GATE_MIN_AMPLITUDE,
  PREVIOUS_GATE_THRESHOLD_STORAGE_KEY,
  STREAM_VOLUME_STORAGE_KEY,
  type MicrophoneMode,
  type NoiseMode
} from './config';
import { isRecord } from '@voice-room/shared/guards';
import { readStorage, writeStorage } from '$lib/shared/storage';

export function isNoiseMode(mode: unknown): mode is NoiseMode {
  return typeof mode === 'string' && Object.hasOwn(NOISE_MODES, mode);
}

export function getNoiseMode(mode: unknown): NoiseMode {
  return isNoiseMode(mode) ? mode : DEFAULT_NOISE_MODE;
}

export function getStoredNoiseMode(): NoiseMode {
  return getNoiseMode(readStorage(NOISE_MODE_STORAGE_KEY));
}

export function getStoredNotificationVolume(): number {
  const parsed = Number.parseInt(readStorage(NOTIFICATION_VOLUME_STORAGE_KEY) || '', 10);
  if (!Number.isFinite(parsed)) return DEFAULT_NOTIFICATION_VOLUME;
  return Math.min(MAX_NOTIFICATION_VOLUME, Math.max(0, parsed));
}

export function getNotificationVolumeMultiplier(): number {
  return getStoredNotificationVolume() / 100;
}

export function getStoredMasterVolume(): number {
  const parsed = Number.parseInt(readStorage(MASTER_VOLUME_STORAGE_KEY) || '', 10);
  if (!Number.isFinite(parsed)) return DEFAULT_MASTER_VOLUME;
  return Math.min(MAX_MASTER_VOLUME, Math.max(0, parsed));
}

export function getStoredMicrophoneVolume(): number {
  const parsed = Number.parseInt(readStorage(MICROPHONE_VOLUME_STORAGE_KEY) || '', 10);
  if (!Number.isFinite(parsed)) return DEFAULT_MICROPHONE_VOLUME;
  return Math.min(MAX_MICROPHONE_VOLUME, Math.max(0, parsed));
}

export function persistMicrophoneVolume(volume: number): number {
  const value = Math.min(MAX_MICROPHONE_VOLUME, Math.max(0, Math.round(volume)));
  writeStorage(MICROPHONE_VOLUME_STORAGE_KEY, String(value));
  return value;
}

export function getStoredMicrophoneMode(): MicrophoneMode {
  if (!window.voiceRoomRuntime?.isDesktop) return DEFAULT_MICROPHONE_MODE;
  return readStorage(MICROPHONE_MODE_STORAGE_KEY) === 'push-to-talk' ? 'push-to-talk' : DEFAULT_MICROPHONE_MODE;
}

export function persistMicrophoneMode(mode: MicrophoneMode): MicrophoneMode {
  const value = mode === 'push-to-talk' ? mode : DEFAULT_MICROPHONE_MODE;
  writeStorage(MICROPHONE_MODE_STORAGE_KEY, value);
  return value;
}

export function persistOutputMuted(muted: boolean): void {
  writeStorage(OUTPUT_MUTED_STORAGE_KEY, String(Boolean(muted)));
}

export function persistNotificationVolume(volume: number): number {
  const value = Math.min(MAX_NOTIFICATION_VOLUME, Math.max(0, Math.round(volume)));
  writeStorage(NOTIFICATION_VOLUME_STORAGE_KEY, String(value));
  return value;
}

export function persistMasterVolume(volume: number): number {
  const value = Math.min(MAX_MASTER_VOLUME, Math.max(0, Math.round(volume)));
  writeStorage(MASTER_VOLUME_STORAGE_KEY, String(value));
  return value;
}

export function getNoiseModeLabel(mode: unknown): string {
  return NOISE_MODES[getNoiseMode(mode)].label;
}

export function getStoredGateThresholdDb(): number {
  const storedValue = Number.parseInt(readStorage(GATE_THRESHOLD_DB_STORAGE_KEY) || '', 10);
  if (Number.isFinite(storedValue)) return clampGateThresholdDb(storedValue);

  const previousValue = Number.parseInt(readStorage(PREVIOUS_GATE_THRESHOLD_STORAGE_KEY) || '', 10);
  if (!Number.isFinite(previousValue)) return DEFAULT_GATE_THRESHOLD_DB;

  const migratedValue = previousGatePercentToDb(previousValue);
  writeStorage(GATE_THRESHOLD_DB_STORAGE_KEY, String(migratedValue));
  return migratedValue;
}

export function getStoredStreamVolume(): number {
  const storedValue = Number.parseFloat(readStorage(STREAM_VOLUME_STORAGE_KEY) || '');
  return Number.isFinite(storedValue) ? clampStreamVolume(storedValue) : DEFAULT_STREAM_VOLUME;
}

export function storeStreamVolume(volume: number, maxVolume = MAX_STREAM_VOLUME): number {
  const clampedVolume = clampStreamVolume(volume, maxVolume);
  writeStorage(STREAM_VOLUME_STORAGE_KEY, String(clampedVolume));
  return clampedVolume;
}

export function normalizeStoredStreamVolume(volume: number, maxVolume = MAX_STREAM_VOLUME): number {
  const clampedVolume = clampStreamVolume(volume, maxVolume);
  if (volume !== clampedVolume) {
    writeStorage(STREAM_VOLUME_STORAGE_KEY, String(clampedVolume));
  }
  return clampedVolume;
}

export function clampStreamVolume(volume: number, maxVolume = MAX_STREAM_VOLUME): number {
  const upperBound = Math.min(MAX_STREAM_VOLUME, Math.max(0, maxVolume));
  return Number.isFinite(volume) ? Math.min(upperBound, Math.max(0, volume)) : DEFAULT_STREAM_VOLUME;
}

export function clampGateThresholdDb(value: number): number {
  return Math.min(GATE_THRESHOLD_MAX_DB, Math.max(GATE_THRESHOLD_MIN_DB, value));
}

export function dbToAmplitude(db: number): number {
  return 10 ** (db / 20);
}

export function amplitudeToDb(amplitude: number): number {
  if (!Number.isFinite(amplitude) || amplitude <= 0) return GATE_THRESHOLD_MIN_DB;
  return Math.max(GATE_THRESHOLD_MIN_DB, Math.min(GATE_THRESHOLD_MAX_DB, 20 * Math.log10(amplitude)));
}

function previousGatePercentToDb(value: number): number {
  if (value <= 0) return DEFAULT_GATE_THRESHOLD_DB;

  const amount = Math.min(100, Math.max(0, value)) / 100;
  const amplitude =
    PREVIOUS_GATE_MIN_AMPLITUDE + amount * amount * (PREVIOUS_GATE_MAX_AMPLITUDE - PREVIOUS_GATE_MIN_AMPLITUDE);
  return Math.round(amplitudeToDb(amplitude));
}

export function getDbMeterPosition(db: number): number {
  const clampedDb = clampGateThresholdDb(db);
  return (clampedDb - GATE_THRESHOLD_MIN_DB) / (GATE_THRESHOLD_MAX_DB - GATE_THRESHOLD_MIN_DB);
}

export interface ParticipantAudioPreference {
  muted: boolean;
  volume: number;
}

const DEFAULT_PARTICIPANT_AUDIO_PREFERENCE: ParticipantAudioPreference = {
  muted: false,
  volume: DEFAULT_PARTICIPANT_VOLUME
};

function readParticipantAudioPreferences(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readStorage(PARTICIPANT_AUDIO_PREFERENCES_STORAGE_KEY) || '{}');
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeParticipantAudioPreferences(preferences: Record<string, unknown>): void {
  writeStorage(PARTICIPANT_AUDIO_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
}

export function getParticipantAudioPreferenceKey(accountUserId: string, peerId: string): string {
  const accountKey = String(accountUserId || '').trim();
  if (accountKey) return `account:${accountKey}`;
  return `peer:${String(peerId || '').trim()}`;
}

export function getParticipantAudioPreference(key: string): ParticipantAudioPreference {
  const entry = readParticipantAudioPreferences()[key];
  const stored = isRecord(entry) ? entry : {};
  return {
    muted: Object.hasOwn(stored, 'muted') ? Boolean(stored.muted) : DEFAULT_PARTICIPANT_AUDIO_PREFERENCE.muted,
    volume: Object.hasOwn(stored, 'volume')
      ? clampParticipantVolume(Number(stored.volume))
      : DEFAULT_PARTICIPANT_AUDIO_PREFERENCE.volume
  };
}

export function storeParticipantAudioPreference(
  key: string,
  patch: Partial<ParticipantAudioPreference>
): ParticipantAudioPreference {
  const preferences = readParticipantAudioPreferences();
  const current = getParticipantAudioPreference(key);
  const next = {
    muted: Object.hasOwn(patch, 'muted') ? Boolean(patch.muted) : current.muted,
    volume: Object.hasOwn(patch, 'volume') ? clampParticipantVolume(Number(patch.volume)) : current.volume
  };
  preferences[key] = next;
  writeParticipantAudioPreferences(preferences);
  return next;
}

function clampParticipantVolume(volume: number): number {
  return Number.isFinite(volume) ? Math.min(MAX_PARTICIPANT_VOLUME, Math.max(0, volume)) : DEFAULT_PARTICIPANT_VOLUME;
}
