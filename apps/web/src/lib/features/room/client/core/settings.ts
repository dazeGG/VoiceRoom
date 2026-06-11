import {
  DEFAULT_GATE_THRESHOLD_DB,
  DEFAULT_NOISE_MODE,
  GATE_THRESHOLD_DB_STORAGE_KEY,
  GATE_THRESHOLD_MAX_DB,
  GATE_THRESHOLD_MIN_DB,
  NOISE_MODES,
  NOISE_MODE_STORAGE_KEY,
  PREVIOUS_GATE_MAX_AMPLITUDE,
  PREVIOUS_GATE_MIN_AMPLITUDE,
  PREVIOUS_GATE_THRESHOLD_STORAGE_KEY,
  type NoiseMode
} from './config';

export function getNoiseMode(mode: unknown): NoiseMode {
  return typeof mode === 'string' && Object.hasOwn(NOISE_MODES, mode)
    ? (mode as NoiseMode)
    : DEFAULT_NOISE_MODE;
}

export function getStoredNoiseMode(): NoiseMode {
  return getNoiseMode(localStorage.getItem(NOISE_MODE_STORAGE_KEY));
}

export function getNoiseModeLabel(mode: unknown): string {
  return NOISE_MODES[getNoiseMode(mode)].label;
}

export function getStoredGateThresholdDb(): number {
  const storedValue = Number.parseInt(localStorage.getItem(GATE_THRESHOLD_DB_STORAGE_KEY) || '', 10);
  if (Number.isFinite(storedValue)) return clampGateThresholdDb(storedValue);

  const previousValue = Number.parseInt(localStorage.getItem(PREVIOUS_GATE_THRESHOLD_STORAGE_KEY) || '', 10);
  if (!Number.isFinite(previousValue)) return DEFAULT_GATE_THRESHOLD_DB;

  const migratedValue = previousGatePercentToDb(previousValue);
  localStorage.setItem(GATE_THRESHOLD_DB_STORAGE_KEY, String(migratedValue));
  return migratedValue;
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

export function previousGatePercentToDb(value: number): number {
  if (value <= 0) return DEFAULT_GATE_THRESHOLD_DB;

  const amount = Math.min(100, Math.max(0, value)) / 100;
  const amplitude = PREVIOUS_GATE_MIN_AMPLITUDE + amount * amount * (PREVIOUS_GATE_MAX_AMPLITUDE - PREVIOUS_GATE_MIN_AMPLITUDE);
  return Math.round(amplitudeToDb(amplitude));
}

export function getDbMeterPosition(db: number): number {
  const clampedDb = clampGateThresholdDb(db);
  return (clampedDb - GATE_THRESHOLD_MIN_DB) / (GATE_THRESHOLD_MAX_DB - GATE_THRESHOLD_MIN_DB);
}
