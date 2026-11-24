import { URL } from 'node:url';
import { AccessToken } from 'livekit-server-sdk';
import { normalizeLiveKitServerUrl } from '@voiceroom/shared/runtime-config';
import { isLiveKitOnlyIdentity, nativeVoiceIdentity } from '@voiceroom/shared/validation';
import type { RoomSurface } from '../rooms/room-surface.policy.ts';
import type { CompanionCredential, CredentialIssue } from './credential-boundary.service.ts';
import type { GatePrincipal } from './gate-principal.ts';
import { liveKitPublishSources } from './livekit-publish.policy.ts';
import { NATIVE_VOICE_LEASE_ATTRIBUTE } from './livekit-token-binding.mts';

export type LiveKitAdmission = {
  gateCredentialId: string;
  room: string;
  token: string;
  ttlSeconds: number;
  url: string;
};

export type AdmissionIssue =
  | { status: 'issued'; admission: LiveKitAdmission }
  | { status: Exclude<CredentialIssue['status'], 'issued'>; admission: null };

function createLiveKitCredentialProvider({
  apiKey,
  apiSecret,
  boundary,
  gateUrl,
  tokenTtlSeconds = 6 * 60 * 60
}: {
  apiKey?: string;
  apiSecret?: string;
  boundary: {
    issueCredential(input: {
      roomId: string;
      peerId: string;
      principal: GatePrincipal;
      companion?: CompanionCredential | undefined;
    }): Promise<CredentialIssue>;
  };
  gateUrl?: string;
  tokenTtlSeconds?: unknown;
}) {
  const credentials = boundary;
  const ttlSeconds = Math.max(60, Number(tokenTtlSeconds) || 6 * 60 * 60);

  async function issueAdmission({
    roomId,
    livekitRoom,
    peerId,
    name = '',
    principal,
    surface = 'main',
    canPublishMicrophone = true,
    canPublishScreen = true,
    companion
  }: {
    roomId?: string;
    livekitRoom?: string;
    peerId?: string;
    name?: string;
    principal?: GatePrincipal | null;
    surface?: RoomSurface;
    canPublishMicrophone?: boolean;
    canPublishScreen?: boolean;
    companion?: CompanionCredential;
  } = {}): Promise<AdmissionIssue> {
    if (
      !apiKey ||
      !apiSecret ||
      !gateUrl ||
      !roomId ||
      !livekitRoom ||
      !peerId ||
      !principal ||
      isLiveKitOnlyIdentity(peerId) ||
      (companion && (surface !== 'main' || principal.principalType !== 'account'))
    ) {
      return { status: 'unavailable', admission: null };
    }
    const gate = await credentials.issueCredential({ roomId, peerId, principal, ...(companion && { companion }) });
    if (gate.status !== 'issued') return { status: gate.status, admission: null };
    const { credential } = gate;

    const tokenTtl = companion ? Math.max(1, Math.ceil((companion.expiresAt - Date.now()) / 1000)) : ttlSeconds;
    const token = new AccessToken(apiKey, apiSecret, {
      identity: companion ? nativeVoiceIdentity(peerId, companion.id) : peerId,
      metadata: JSON.stringify({ roomId }),
      ...(companion && { attributes: { [NATIVE_VOICE_LEASE_ATTRIBUTE]: companion.id } }),
      // Meet distributes display names through its in-memory API roster.
      name: surface === 'meet' ? '' : name,
      ttl: tokenTtl
    });
    const canPublishSources = companion
      ? []
      : liveKitPublishSources(surface, {
          microphone: canPublishMicrophone,
          screen: canPublishScreen
        });
    // Chat, reactions and presence travel over the API, never LiveKit data
    // packets, and the client binds no data handler. Granting data would only
    // let a modified client flood everyone in the room.
    token.addGrant({
      canPublish: canPublishSources.length > 0,
      canPublishData: false,
      canPublishSources,
      canSubscribe: true,
      ...(companion && { canUpdateOwnMetadata: false, hidden: true }),
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
        ttlSeconds: tokenTtl,
        url: publicUrl.toString()
      }
    };
  }

  return Object.freeze({ issueAdmission });
}

export type LiveKitCredentialProvider = ReturnType<typeof createLiveKitCredentialProvider>;

export { createLiveKitCredentialProvider };
