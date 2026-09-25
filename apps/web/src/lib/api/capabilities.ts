import type { Capabilities } from '@voice-room/shared/contracts/ops';
import { api } from './client';
export type CapabilityKey =
  | 'historyCursor'
  | 'readCursor'
  | 'replies'
  | 'membership'
  | 'engagement'
  | 'reactions'
  | 'mediaRead'
  | 'mediaUploads'
  | 'moderationCenter';

export type CapabilityFeatures = Record<CapabilityKey, boolean>;

export type CapabilityResponse = Capabilities;

let cache: Promise<CapabilityResponse> | null = null;

export async function loadCapabilities(): Promise<CapabilityResponse> {
  if (!cache) {
    cache = api.get<CapabilityResponse>('/api/capabilities');
  }
  return cache;
}

export function resetCapabilities(): void {
  cache = null;
}

export async function isCapabilityReady(key: CapabilityKey, fallback = false): Promise<boolean> {
  const payload = await loadCapabilities();
  const value = payload.features[key];
  return typeof value === 'boolean' ? value : fallback;
}
