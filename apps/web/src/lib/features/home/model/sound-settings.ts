// The Settings → «Звук» tab edits the very same localStorage keys the in-room
// microphone/output pipeline reads on join (see
// room/client/model/room-state.ts + room/client/ui/devices.ts), so anything the
// user changes here is already applied the next time they enter a room. We reuse
// the room's config + settings helpers to keep the contract in one place, and
// mirror the dock's gate control (a single slider over a live meter — the floor
// threshold means «off», there is no separate toggle).
import {
  DEFAULT_GATE_THRESHOLD_DB,
  DEFAULT_NOISE_MODE,
  DEFAULT_NOTIFICATION_VOLUME,
  GATE_THRESHOLD_DB_STORAGE_KEY,
  GATE_THRESHOLD_MAX_DB,
  GATE_THRESHOLD_MIN_DB,
  MICROPHONE_DEVICE_STORAGE_KEY,
  NOISE_MODES,
  NOISE_MODE_STORAGE_KEY,
  OUTPUT_DEVICE_STORAGE_KEY,
  type NoiseMode
} from '$lib/features/room/client/core/config';
import {
  amplitudeToDb,
  clampGateThresholdDb,
  getDbMeterPosition,
  getNoiseMode,
  getStoredGateThresholdDb,
  getStoredNoiseMode,
  getStoredNotificationVolume
} from '$lib/features/room/client/core/settings';

export { getNotificationVolumeMultiplier, persistNotificationVolume } from '$lib/features/room/client/core/settings';

export { GATE_THRESHOLD_MAX_DB, GATE_THRESHOLD_MIN_DB };

export interface DeviceOption {
  deviceId: string;
  label: string;
}

export interface NoiseOption {
  value: NoiseMode;
  label: string;
}

export const NOISE_OPTIONS: NoiseOption[] = (Object.keys(NOISE_MODES) as NoiseMode[]).map((value) => ({
  label: NOISE_MODES[value].label,
  value
}));

export interface SoundSettings {
  microphoneDeviceId: string;
  outputDeviceId: string;
  noiseMode: NoiseMode;
  gateThresholdDb: number;
  notificationVolume: number;
}

// The gate is disabled when parked at the floor — exactly how the room decides
// (room/client/services/microphone-service.ts).
export function isGateDisabled(db: number): boolean {
  return db <= GATE_THRESHOLD_MIN_DB;
}

export function gateValueLabel(db: number): string {
  return isGateDisabled(db) ? 'Выкл' : `${db} dB`;
}

// 0..1 position of a dB value along the [-100, 0] meter — reused for both the
// gate marker and the live level fill so they share one scale.
export function gateMeterPosition(db: number): number {
  return getDbMeterPosition(db);
}

function readDeviceId(key: string): string {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

export function readSoundSettings(): SoundSettings {
  try {
    return {
      gateThresholdDb: getStoredGateThresholdDb(),
      microphoneDeviceId: readDeviceId(MICROPHONE_DEVICE_STORAGE_KEY),
      noiseMode: getStoredNoiseMode(),
      outputDeviceId: readDeviceId(OUTPUT_DEVICE_STORAGE_KEY),
      notificationVolume: getStoredNotificationVolume()
    };
  } catch {
    return {
      gateThresholdDb: DEFAULT_GATE_THRESHOLD_DB,
      microphoneDeviceId: '',
      noiseMode: DEFAULT_NOISE_MODE,
      outputDeviceId: '',
      notificationVolume: DEFAULT_NOTIFICATION_VOLUME
    };
  }
}

function persistDeviceId(key: string, deviceId: string): void {
  try {
    if (deviceId) localStorage.setItem(key, deviceId);
    else localStorage.removeItem(key);
  } catch {
    // Storage may be unavailable (private mode/quota); the room falls back to its defaults.
  }
}

export function persistMicrophone(deviceId: string): void {
  persistDeviceId(MICROPHONE_DEVICE_STORAGE_KEY, deviceId);
}

export function persistSpeaker(deviceId: string): void {
  persistDeviceId(OUTPUT_DEVICE_STORAGE_KEY, deviceId);
}

export function persistNoiseMode(mode: string): NoiseMode {
  const next = getNoiseMode(mode);
  try {
    localStorage.setItem(NOISE_MODE_STORAGE_KEY, next);
  } catch {
    // Ignore storage failures.
  }
  return next;
}

export function persistGateThreshold(thresholdDb: number): number {
  const value = clampGateThresholdDb(Math.round(thresholdDb));
  try {
    localStorage.setItem(GATE_THRESHOLD_DB_STORAGE_KEY, String(value));
  } catch {
    // Ignore storage failures.
  }
  return value;
}

async function enumerate(kind: MediaDeviceKind, fallback: string): Promise<DeviceOption[]> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === kind)
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `${fallback} ${index + 1}`
      }));
  } catch {
    return [];
  }
}

export function enumerateMicrophones(): Promise<DeviceOption[]> {
  return enumerate('audioinput', 'Микрофон');
}

export function enumerateSpeakers(): Promise<DeviceOption[]> {
  return enumerate('audiooutput', 'Динамик');
}

export interface MicMeter {
  stop(): void;
}

// Lightweight standalone level meter for the gate control — mirrors the room's
// RMS→dB computation (media/meters.ts) but captures its own short-lived stream
// so the user can tune the gate threshold against their live mic from the lobby.
// Returns null (and holds nothing open) when capture is unavailable or denied.
export async function startMicMeter(
  deviceId: string,
  onLevelDb: (db: number) => void
): Promise<MicMeter | null> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return null;

  let stream: MediaStream | null = null;
  let context: AudioContext | null = null;
  let frame = 0;
  let stopped = false;

  const cleanup = (): void => {
    stopped = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    if (context) {
      void context.close().catch(() => {});
      context = null;
    }
  };

  try {
    const audio: MediaTrackConstraints = deviceId ? { deviceId: { ideal: deviceId } } : {};
    stream = await navigator.mediaDevices.getUserMedia({ audio });
    if (stopped) {
      cleanup();
      return null;
    }

    context = new AudioContext();
    await context.resume().catch(() => {});
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = (): void => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const value of data) {
        const centered = value - 128;
        sum += centered * centered;
      }
      const rms = Math.sqrt(sum / data.length);
      onLevelDb(amplitudeToDb(Math.min(1, rms / 128)));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  } catch {
    cleanup();
    return null;
  }

  return { stop: cleanup };
}
