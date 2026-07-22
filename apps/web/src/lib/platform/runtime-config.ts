import {
  DEFAULT_RUNTIME_CONFIG,
  parseRuntimeConfig,
  type RuntimeConfigV1
} from '@voice-room/shared/runtime-config';

const CONFIG_PATH = '/runtime-config.json';
const LOAD_TIMEOUT_MS = 2_000;

let configCache = new Map<string, Promise<RuntimeConfigV1>>();

type RuntimeConfigOptions = {
  origin?: string;
};

const SENSITIVE_KEY_PATTERNS: RegExp[] = [
  /(api[-_]?key)/i,
  /(secret|token|credential|password)/i
];

function hasSuspiciousSecrets(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (value instanceof Array) return value.some(hasSuspiciousSecrets);

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key))) return true;
    if (typeof nested === 'object' && hasSuspiciousSecrets(nested)) return true;
  }

  return false;
}

function resolveConfigOrigin(override?: string): string {
  if (typeof override === 'string' && override.trim()) return override.trim();
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  if (typeof process !== 'undefined' && typeof process.env.RUNTIME_CONFIG_ORIGIN === 'string' && process.env.RUNTIME_CONFIG_ORIGIN.trim()) {
    return process.env.RUNTIME_CONFIG_ORIGIN.trim();
  }
  return 'about:blank';
}

function resolveConfigUrl(overrideOrigin?: string): string {
  return new URL(CONFIG_PATH, resolveConfigOrigin(overrideOrigin)).toString();
}

function cacheKey(overrideOrigin?: string): string {
  return resolveConfigOrigin(overrideOrigin);
}

function defaultConfig(): RuntimeConfigV1 {
  return {
    ...DEFAULT_RUNTIME_CONFIG,
    livekit: {
      wsUrl: DEFAULT_RUNTIME_CONFIG.livekit.wsUrl,
      connectFallbacks: [...DEFAULT_RUNTIME_CONFIG.livekit.connectFallbacks]
    }
  };
}

async function fetchRuntimeConfig(originOverride?: string): Promise<RuntimeConfigV1> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);
  try {
    const response = await fetch(resolveConfigUrl(originOverride), {
      cache: 'no-store',
      headers: { Accept: 'application/json, text/plain;q=0.9' },
      signal: controller.signal
    });
    if (!response.ok) return defaultConfig();

    const text = await response.text();
    let parsedForScan: unknown;
    try {
      parsedForScan = JSON.parse(text);
    } catch {
      return defaultConfig();
    }
    if (hasSuspiciousSecrets(parsedForScan)) return defaultConfig();

    const parsed = parseRuntimeConfig(text);
    return parsed ?? defaultConfig();
  } catch {
    return defaultConfig();
  } finally {
    clearTimeout(timeout);
  }
}

export function loadRuntimeConfig(options: RuntimeConfigOptions = {}): Promise<RuntimeConfigV1> {
  const key = cacheKey(options.origin);
  const existing = configCache.get(key);
  if (existing) return existing;

  const next = fetchRuntimeConfig(options.origin);
  configCache.set(key, next);
  return next;
}

export async function resolveLiveKitUrls(apiUrl: string, options: RuntimeConfigOptions = {}): Promise<string[]> {
  const config = await loadRuntimeConfig(options);
  const candidates = [config.livekit.wsUrl, apiUrl, ...config.livekit.connectFallbacks];
  return [...new Set(candidates.filter(Boolean))];
}

export function resetRuntimeConfig(): void {
  configCache = new Map();
}
