'use strict';

const RUNTIME_CONFIG_CONTRACT = 'voice-room.runtime-config/v1';
const RUNTIME_SCHEMA_VERSION = 1;

const runtimeLiveKitUrl = typeof process !== 'undefined' && process?.env
  ? process.env.RUNTIME_LIVEKIT_URL || ''
  : '';

const DEFAULT_RUNTIME_CONFIG = {
  contractVersion: RUNTIME_CONFIG_CONTRACT,
  schemaVersion: RUNTIME_SCHEMA_VERSION,
  livekit: {
    wsUrl: runtimeLiveKitUrl,
    connectFallbacks: []
  }
};

function normalizeLiveKitUrl(value) {
  if (typeof value !== 'string') return '';
  const url = value.trim();
  return /^wss?:\/\//i.test(url) ? url : '';
}

function normalizePayload(value) {
  if (!value || typeof value !== 'object') return null;
  const candidate = {
    contractVersion: RUNTIME_CONFIG_CONTRACT,
    schemaVersion: RUNTIME_SCHEMA_VERSION,
    livekit: {
      wsUrl: normalizeLiveKitUrl(value.livekit?.wsUrl),
      connectFallbacks: Array.isArray(value.livekit?.connectFallbacks)
        ? value.livekit.connectFallbacks
            .map((item) => normalizeLiveKitUrl(item))
            .filter(Boolean)
        : []
    }
  };

  if (!candidate.livekit.wsUrl && !candidate.livekit.connectFallbacks.length) return null;

  const values = new Set([candidate.livekit.wsUrl, ...candidate.livekit.connectFallbacks]);
  candidate.livekit.connectFallbacks = [...values].filter((value) => value !== candidate.livekit.wsUrl);

  return candidate;
}

function parseRuntimeConfig(raw) {
  if (typeof raw !== 'string') return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (parsed?.contractVersion !== RUNTIME_CONFIG_CONTRACT) return null;
  return normalizePayload(parsed) || null;
}

function getRuntimeConfig(raw) {
  const parsed = parseRuntimeConfig(raw);
  return parsed || {
    ...DEFAULT_RUNTIME_CONFIG,
    livekit: {
      ...DEFAULT_RUNTIME_CONFIG.livekit,
      wsUrl: normalizeLiveKitUrl(DEFAULT_RUNTIME_CONFIG.livekit.wsUrl),
      connectFallbacks: DEFAULT_RUNTIME_CONFIG.livekit.connectFallbacks
    }
  };
}

module.exports = {
  DEFAULT_RUNTIME_CONFIG,
  RUNTIME_CONFIG_CONTRACT,
  RUNTIME_SCHEMA_VERSION,
  getRuntimeConfig,
  parseRuntimeConfig,
  normalizeLiveKitUrl
};
