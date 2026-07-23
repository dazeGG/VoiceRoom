export interface RuntimeConfigV1 {
  contractVersion: 'voice-room.runtime-config/v1';
  schemaVersion: 1;
  livekit: {
    wsUrl: string;
    connectFallbacks: string[];
  };
}

export const RUNTIME_CONFIG_CONTRACT: RuntimeConfigV1['contractVersion'];
export const RUNTIME_SCHEMA_VERSION: RuntimeConfigV1['schemaVersion'];
export const DEFAULT_RUNTIME_CONFIG: RuntimeConfigV1;
export function normalizeLiveKitUrl(value: unknown): string;
export function inheritLiveKitGateCredential(targetUrl: unknown, credentialUrl: unknown): string;
export function parseRuntimeConfig(raw: string): RuntimeConfigV1 | null;
export function getRuntimeConfig(raw: string): RuntimeConfigV1;
export function resolveLiveKitConnectUrls(runtimeConfig: RuntimeConfigV1, apiUrl: unknown): string[];
