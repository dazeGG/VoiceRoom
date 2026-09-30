// The runtime config the web app reads from /runtime-config.json: which
// LiveKit URLs to try. Anything malformed falls back to the build default,
// and a gate credential carried by the API's URL is kept on every fallback.

export interface RuntimeConfigV1 {
  contractVersion: 'voice-room.runtime-config/v1';
  schemaVersion: 1;
  livekit: {
    wsUrl: string;
    connectFallbacks: string[];
  };
}

const RUNTIME_CONFIG_CONTRACT: RuntimeConfigV1['contractVersion'] = 'voice-room.runtime-config/v1';
const RUNTIME_SCHEMA_VERSION: RuntimeConfigV1['schemaVersion'] = 1;

// The API reads RUNTIME_LIVEKIT_URL; the browser has no process at all.
const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
const runtimeLiveKitUrl = runtimeProcess?.env ? runtimeProcess.env.RUNTIME_LIVEKIT_URL || '' : '';

const DEFAULT_RUNTIME_CONFIG: RuntimeConfigV1 = {
  contractVersion: RUNTIME_CONFIG_CONTRACT,
  schemaVersion: RUNTIME_SCHEMA_VERSION,
  livekit: {
    wsUrl: runtimeLiveKitUrl,
    connectFallbacks: []
  }
};

function normalizeLiveKitUrl(value: unknown): string {
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

function normalizeLiveKitServerUrl(value: unknown): string {
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

function inheritLiveKitGateCredential(targetUrl: unknown, credentialUrl: unknown): string {
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

function resolveLiveKitConnectUrls(runtimeConfig: RuntimeConfigV1 | null | undefined, apiUrl: unknown): string[] {
  const api = normalizeLiveKitServerUrl(apiUrl);
  const configured = [runtimeConfig?.livekit?.wsUrl, ...(runtimeConfig?.livekit?.connectFallbacks || [])]
    .map((url) => inheritLiveKitGateCredential(url, api))
    .filter(Boolean);
  return [...new Set([...configured, api].filter(Boolean))];
}

function normalizePayload(value: unknown): RuntimeConfigV1 | null {
  if (!value || typeof value !== 'object') return null;
  const livekit = (value as { livekit?: { wsUrl?: unknown; connectFallbacks?: unknown } }).livekit;
  const candidate: RuntimeConfigV1 = {
    contractVersion: RUNTIME_CONFIG_CONTRACT,
    schemaVersion: RUNTIME_SCHEMA_VERSION,
    livekit: {
      wsUrl: normalizeLiveKitServerUrl(livekit?.wsUrl),
      connectFallbacks: Array.isArray(livekit?.connectFallbacks)
        ? livekit.connectFallbacks.map((item: unknown) => normalizeLiveKitServerUrl(item)).filter(Boolean)
        : []
    }
  };

  if (!candidate.livekit.wsUrl && !candidate.livekit.connectFallbacks.length) return null;

  const values = new Set([candidate.livekit.wsUrl, ...candidate.livekit.connectFallbacks]);
  candidate.livekit.connectFallbacks = [...values].filter((url) => url !== candidate.livekit.wsUrl);

  return candidate;
}

function parseRuntimeConfig(raw: unknown): RuntimeConfigV1 | null {
  if (typeof raw !== 'string') return null;
  let parsed: { contractVersion?: unknown; schemaVersion?: unknown } | null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (parsed?.contractVersion !== RUNTIME_CONFIG_CONTRACT || parsed?.schemaVersion !== RUNTIME_SCHEMA_VERSION)
    return null;
  return normalizePayload(parsed) || null;
}

function getRuntimeConfig(raw: unknown): RuntimeConfigV1 {
  const parsed = parseRuntimeConfig(raw);
  return (
    parsed || {
      ...DEFAULT_RUNTIME_CONFIG,
      livekit: {
        ...DEFAULT_RUNTIME_CONFIG.livekit,
        wsUrl: normalizeLiveKitServerUrl(DEFAULT_RUNTIME_CONFIG.livekit.wsUrl),
        connectFallbacks: DEFAULT_RUNTIME_CONFIG.livekit.connectFallbacks
      }
    }
  );
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
