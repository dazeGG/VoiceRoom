import { PUBLIC_CAPABILITY_KEYS } from '@voice-room/shared/capabilities';
import { isCapabilityReady, loadCapabilities, resetCapabilities, type CapabilityKey } from '../api/capabilities';

export type CapabilityEdge = 'unknown' | 'ready' | 'not-ready' | 'stale';

export interface CapabilityState {
  contractVersion: 1;
  ready: boolean;
  features: Record<string, boolean>;
  loaded: boolean;
  stale: boolean;
  edge: CapabilityEdge;
}

const PUBLIC_FEATURE_KEYS = new Set(PUBLIC_CAPABILITY_KEYS.map((key) => String(key)));

const INITIAL_FEATURES: Record<string, boolean> = Object.fromEntries(
  Array.from(PUBLIC_FEATURE_KEYS).map((key) => [key, false])
);

const INITIAL_STATE: CapabilityState = {
  contractVersion: 1,
  ready: false,
  features: { ...INITIAL_FEATURES },
  loaded: false,
  stale: false,
  edge: 'unknown'
};

let state: CapabilityState = { ...INITIAL_STATE, features: { ...INITIAL_FEATURES } };
let inFlight: Promise<CapabilityState> | null = null;

export function resetCapabilityState(): void {
  state = { ...INITIAL_STATE, features: { ...INITIAL_FEATURES } };
  inFlight = null;
  resetCapabilities();
}

function sanitizePayload(payload: unknown): CapabilityState {
  const value = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : null;
  if (!value) {
    return { ...INITIAL_STATE, features: { ...INITIAL_FEATURES }, stale: true };
  }

  const rawFeatures = typeof value.features === 'object' && value.features !== null ? (value.features as Record<string, unknown>) : {};
  const features: Record<string, boolean> = { ...INITIAL_FEATURES };
  for (const [key, featureValue] of Object.entries(rawFeatures)) {
    if (PUBLIC_FEATURE_KEYS.has(key)) {
      features[key] = featureValue === true;
    }
  }

  const contractVersion = 1 as const;
  const stale = value.contractVersion !== contractVersion;
  const ready = !stale && Object.values(features).some(Boolean);

  return {
    contractVersion,
    ready,
    features,
    loaded: true,
    stale,
    edge: stale ? 'stale' : ready ? 'ready' : 'not-ready'
  };
}

export async function loadCapabilityState(): Promise<CapabilityState> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const payload = await loadCapabilities();
      state = sanitizePayload(payload);
      return state;
    } catch {
      state = { ...INITIAL_STATE, features: { ...INITIAL_FEATURES }, loaded: true, stale: false, edge: 'unknown' };
      return state;
    }
  })();

  const next = await inFlight;
  inFlight = null;
  return next;
}

export function getCapabilityState(): CapabilityState {
  return { ...state, features: { ...state.features } };
}

export async function getCapabilityFeature(key: string, fallback = false): Promise<boolean> {
  const snapshot = await loadCapabilityState();
  if (PUBLIC_FEATURE_KEYS.has(key)) {
    return Boolean(snapshot.features[key]);
  }
  return isCapabilityReady(key as CapabilityKey, fallback);
}
