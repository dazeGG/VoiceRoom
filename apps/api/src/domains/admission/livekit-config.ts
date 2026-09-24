// How the API reaches LiveKit, read from the environment. The admin URL is the
// internal SFU address; the gate URL is what browsers connect to. LiveKit is
// only "enabled" when both exist, credentials are set, and browsers do not
// talk to the SFU directly (that would bypass the auth gate).

import { cleanLiveKitUrl } from '@voice-room/shared/validation';

export interface LiveKitConfig {
  adminUrl: string;
  apiKey: string;
  apiSecret: string;
  enabled: boolean;
  gateSecret: string;
  gateUrl: string;
  url: string;
}

export function liveKitHttpUrl(url: string): string {
  return String(url || '').replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
}

export function readLiveKitConfig(
  env: Record<string, string | undefined>,
  { gatePublicUrl, gateSecret }: { gatePublicUrl: string; gateSecret: string }
): LiveKitConfig {
  const url: string = cleanLiveKitUrl(env.LIVEKIT_INTERNAL_URL || env.LIVEKIT_URL || '');
  const gateUrl: string = cleanLiveKitUrl(gatePublicUrl || url);
  const apiKey = (env.LIVEKIT_API_KEY || '').trim();
  const apiSecret = (env.LIVEKIT_API_SECRET || '').trim();
  const adminUrl = liveKitHttpUrl(url);
  return {
    adminUrl,
    apiKey,
    apiSecret,
    enabled: Boolean(url && gateUrl && apiKey && apiSecret && adminUrl !== liveKitHttpUrl(gateUrl)),
    gateSecret,
    gateUrl,
    url
  };
}
