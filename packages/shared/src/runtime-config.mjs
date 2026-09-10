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
  if (!/^wss?:\/\//i.test(url)) return '';
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function normalizeLiveKitServerUrl(value) {
  const normalized = normalizeLiveKitUrl(value);
  if (!normalized) return '';

  try {
    const parsed = new URL(normalized);
    if (/^\/rtc\/?$/i.test(parsed.pathname)) parsed.pathname = '/';
    return parsed.toString();
  } catch {
    return normalized;
  }
}

function inheritLiveKitGateCredential(targetUrl, credentialUrl) {
  const target = normalizeLiveKitServerUrl(targetUrl);
  const source = normalizeLiveKitServerUrl(credentialUrl);
  if (!target || !source) return target;

  try {
    const credential = new URL(source).searchParams.get('vr_gate_credential');
    if (!credential) return target;
    const resolved = new URL(target);
    resolved.searchParams.set('vr_gate_credential', credential);
    return resolved.toString();
  } catch {
    return target;
  }
}

function resolveLiveKitConnectUrls(runtimeConfig, apiUrl) {
  const api = normalizeLiveKitServerUrl(apiUrl);
  const configured = [runtimeConfig?.livekit?.wsUrl, ...(runtimeConfig?.livekit?.connectFallbacks || [])]
    .map((url) => inheritLiveKitGateCredential(url, api))
    .filter(Boolean);
  return [...new Set([...configured, api].filter(Boolean))];
}

function normalizePayload(value) {
  if (!value || typeof value !== 'object') return null;
  const candidate = {
    contractVersion: RUNTIME_CONFIG_CONTRACT,
    schemaVersion: RUNTIME_SCHEMA_VERSION,
    livekit: {
      wsUrl: normalizeLiveKitServerUrl(value.livekit?.wsUrl),
      connectFallbacks: Array.isArray(value.livekit?.connectFallbacks)
        ? value.livekit.connectFallbacks
            .map((item) => normalizeLiveKitServerUrl(item))
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

  if (
    parsed?.contractVersion !== RUNTIME_CONFIG_CONTRACT ||
    parsed?.schemaVersion !== RUNTIME_SCHEMA_VERSION
  ) return null;
  return normalizePayload(parsed) || null;
}

function getRuntimeConfig(raw) {
  const parsed = parseRuntimeConfig(raw);
  return parsed || {
    ...DEFAULT_RUNTIME_CONFIG,
    livekit: {
      ...DEFAULT_RUNTIME_CONFIG.livekit,
      wsUrl: normalizeLiveKitServerUrl(DEFAULT_RUNTIME_CONFIG.livekit.wsUrl),
      connectFallbacks: DEFAULT_RUNTIME_CONFIG.livekit.connectFallbacks
    }
  };
}

export {
  DEFAULT_RUNTIME_CONFIG,
  RUNTIME_CONFIG_CONTRACT,
  RUNTIME_SCHEMA_VERSION,
  getRuntimeConfig,
  inheritLiveKitGateCredential,
  parseRuntimeConfig,
  normalizeLiveKitUrl,
  normalizeLiveKitServerUrl,
  resolveLiveKitConnectUrls
};
