export const DEFAULT_NOISE_MODE = 'rnnoise';
export const DEFAULT_GATE_THRESHOLD_DB = -100;
export const GATE_THRESHOLD_DB_STORAGE_KEY = 'voice-room:gate-threshold-db';
export const PREVIOUS_GATE_THRESHOLD_STORAGE_KEY = 'voice-room:gate-threshold';
export const GATE_THRESHOLD_MAX_DB = 0;
export const GATE_THRESHOLD_MIN_DB = -100;
export const PREVIOUS_GATE_MAX_AMPLITUDE = 0.18;
export const PREVIOUS_GATE_MIN_AMPLITUDE = 0.006;
export const AUDIO_GATE_WORKLET_URL = '/audio-gate.worklet.js';
export const DESKTOP_AUDIO_SOURCE_WORKLET_URL = '/desktop-audio-source.worklet.js';
export const GATE_ATTACK_MS = 8;
export const GATE_CLOSE_RATIO = 0.65;
export const GATE_DETECTOR_ATTACK_MS = 4;
export const GATE_DETECTOR_RELEASE_MS = 55;
export const GATE_FLOOR_GAIN = 0.02;
export const GATE_HOLD_MS = 140;
export const GATE_PROCESSOR_BUFFER_SIZE = 2048;
export const GATE_RELEASE_MS = 160;
export const NOTIFICATION_VOLUME_BOOST = 5;
export const MICROPHONE_DEVICE_STORAGE_KEY = 'voice-room:microphone-device-id';
export const NOISE_MODE_STORAGE_KEY = 'voice-room:noise-mode';
export const OUTPUT_DEVICE_STORAGE_KEY = 'voice-room:output-device-id';
export const OUTPUT_MUTED_STORAGE_KEY = 'voice-room:output-muted';
export const STREAM_VOLUME_STORAGE_KEY = 'voice-room:stream-volume';
export const DEFAULT_STREAM_VOLUME = 0.5;
export const MAX_STREAM_VOLUME = 2;
export const PEER_LATENCY_INTERVAL_MS = 3000;
export const PEER_LATENCY_GOOD_MS = 150;
export const PEER_LATENCY_FAIR_MS = 300;
export const PEER_JOIN_CUE_DEDUPE_MS = 4000;
export const STREAM_CUE_DEDUPE_MS = 1500;
export const STREAM_VIEWER_CUE_DEDUPE_MS = 1200;
export const GATE_CAPTURE_SWITCH_DEBOUNCE_MS = 700;
export const LOCAL_GATE_DISABLED_SPEAKING_DB = -42;
export const SPEAKING_STATS_INTERVAL_MS = 200;

export type NoiseMode = 'browser' | 'off' | 'rnnoise';

export interface NoiseModeOption {
  label: string;
  nativeNoiseSuppression: boolean;
}

export const NOISE_MODES: Record<NoiseMode, NoiseModeOption> = {
  browser: {
    label: 'Браузерный',
    nativeNoiseSuppression: true
  },
  off: {
    label: 'Выкл',
    nativeNoiseSuppression: false
  },
  rnnoise: {
    label: 'RNNoise',
    nativeNoiseSuppression: false
  }
};

export const RNNOISE_ASSET_BASE = '/rnnoise/';
export const DEFAULT_SCREEN_QUALITY_ID = 'balanced';
export const DEFAULT_SCREEN_FPS_ID = '30';
export const DEFAULT_SCREEN_PROFILE_ID = `${DEFAULT_SCREEN_QUALITY_ID}-${DEFAULT_SCREEN_FPS_ID}`;
export const MICROPHONE_AUDIO_BITRATE = 64_000;
export const SCREEN_AUDIO_BITRATE = 192_000;
export const SCREEN_ADAPT_GOOD_SAMPLE_TARGET = 16;
export const SCREEN_ADAPT_MIN_INTERVAL_MS = 20_000;
export const SCREEN_ADAPT_POOR_SAMPLE_TARGET = 3;
export const SCREEN_ADAPT_PROFILE_ORDER = ['low-15', 'low-30', 'balanced-15', 'balanced-30', 'high-15', 'high-30'];
export const SCREEN_STATS_INTERVAL_MS = 1500;
export const SCREEN_VIDEO_BACKUP_CODEC: string = 'vp8';
export const PEER_SESSION_STORAGE_PREFIX = 'voice-room:peer-session:';
export const ROOM_PROOF_BATCH_SIZE = 64;

export interface ScreenQualityOption {
  bitrateByFps: Record<string, number>;
  height: number;
  id: string;
  label: string;
  width: number;
}

export const SCREEN_QUALITY_OPTIONS: Record<string, ScreenQualityOption> = {
  balanced: {
    bitrateByFps: {
      15: 1_300_000,
      30: 2_000_000
    },
    height: 720,
    id: 'balanced',
    label: '720p',
    width: 1280
  },
  high: {
    bitrateByFps: {
      15: 3_200_000,
      30: 5_000_000
    },
    height: 1080,
    id: 'high',
    label: '1080p',
    width: 1920
  },
  low: {
    bitrateByFps: {
      15: 850_000,
      30: 1_150_000
    },
    height: 540,
    id: 'low',
    label: '540p',
    width: 960
  }
};

export const SCREEN_QUALITY_ORDER = ['low', 'balanced', 'high'];

export interface ScreenFpsOption {
  contentHint: string;
  frameRate: number;
  id: string;
  label: string;
}

export const SCREEN_FPS_OPTIONS: Record<string, ScreenFpsOption> = {
  15: {
    contentHint: 'detail',
    frameRate: 15,
    id: '15',
    label: '15 FPS'
  },
  30: {
    contentHint: 'motion',
    frameRate: 30,
    id: '30',
    label: '30 FPS'
  }
};
