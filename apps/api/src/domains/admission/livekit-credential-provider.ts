import { URL } from 'node:url';
import { AccessToken, TrackSource } from 'livekit-server-sdk';
import { normalizeLiveKitServerUrl } from '@voice-room/shared/runtime-config';
import type { CredentialIssue, GatePrincipal, IssuedCredential } from './credential-boundary.service.ts';

export type LiveKitAdmission = {
  gateCredentialId: string;
  room: string;
  token: string;
  ttlSeconds: number;
  url: string;
};

export type AdmissionIssue = { status: 'issued'; admission: LiveKitAdmission } | { status: string; admission: null };

function createLiveKitCredentialProvider({
  apiKey,
  apiSecret,
  boundary,
  gateUrl,
  tokenTtlSeconds = 6 * 60 * 60
}: {
  apiKey?: string;
  apiSecret?: string;
  boundary?: {
    issueCredential(input: { roomId: string; peerId: string; principal: GatePrincipal }): Promise<CredentialIssue>;
  };
  gateUrl?: string;
  tokenTtlSeconds?: unknown;
} = {}) {
  if (!boundary || typeof boundary.issueCredential !== 'function')
    throw new TypeError('credential boundary is required');
  const credentials = boundary;
  const ttlSeconds = Math.max(60, Number(tokenTtlSeconds) || 6 * 60 * 60);

  async function issueAdmission({
    roomId,
    livekitRoom,
    peerId,
    name = '',
    principal,
    canPublishMicrophone = true
  }: {
    roomId?: string;
    livekitRoom?: string;
    peerId?: string;
    name?: string;
    principal?: GatePrincipal | null;
    canPublishMicrophone?: boolean;
  } = {}): Promise<AdmissionIssue> {
    if (!apiKey || !apiSecret || !gateUrl || !roomId || !livekitRoom || !peerId || !principal) {
      return { status: 'unavailable', admission: null };
    }
    const gate = await credentials.issueCredential({ roomId, peerId, principal });
    if (gate.status !== 'issued') return { status: gate.status, admission: null };
    // An issued answer always carries its credential.
    const credential = gate.credential as IssuedCredential;

    const token = new AccessToken(apiKey, apiSecret, {
      identity: peerId,
      metadata: JSON.stringify({ roomId }),
      name,
      ttl: ttlSeconds
    });
    const canPublishSources = [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO];
    if (canPublishMicrophone !== false) canPublishSources.unshift(TrackSource.MICROPHONE);
    // Chat, reactions and presence travel over the API, never LiveKit data
    // packets, and the client binds no data handler. Granting data would only
    // let a modified client flood everyone in the room.
    token.addGrant({
      canPublish: true,
      canPublishData: false,
      canPublishSources,
      canSubscribe: true,
      room: livekitRoom,
      roomJoin: true
    });
    const publicUrl = new URL(normalizeLiveKitServerUrl(gateUrl));
    publicUrl.searchParams.set('vr_gate_credential', credential.value);
    return {
      status: 'issued',
      admission: {
        gateCredentialId: credential.id,
        room: livekitRoom,
        token: await token.toJwt(),
        ttlSeconds,
        url: publicUrl.toString()
      }
    };
  }

  return Object.freeze({ issueAdmission });
}

export type LiveKitCredentialProvider = ReturnType<typeof createLiveKitCredentialProvider>;

export { createLiveKitCredentialProvider };
