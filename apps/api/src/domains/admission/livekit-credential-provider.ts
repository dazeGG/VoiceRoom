import { URL } from 'node:url';
import { AccessToken } from 'livekit-server-sdk';
import { normalizeLiveKitServerUrl } from '@voiceroom/shared/runtime-config';
import { isLiveKitOnlyIdentity, nativeVoiceIdentity } from '@voiceroom/shared/validation';
import type { RoomSurface } from '../rooms/room-surface.policy.ts';
import type { CompanionCredential, CredentialIssue } from './credential-boundary.service.ts';
import type { GatePrincipal } from './gate-principal.ts';
import { liveKitPublishSources } from './livekit-publish.policy.ts';
import { NATIVE_VOICE_LEASE_ATTRIBUTE } from './livekit-token-binding.mts';

// Cover the SFU's five-minute refresh interval even before its first refresh arrives.
const SLIDING_COMPANION_TOKEN_TTL_SECONDS = 600;

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
      call?: true | undefined;
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
    companion,
    call
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
    call?: true;
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
      (companion && (surface !== 'main' || principal.principalType !== 'account')) ||
      (call && (surface !== 'main' || companion || principal.principalType !== 'account'))
    ) {
      return { status: 'unavailable', admission: null };
    }
    const gate = await credentials.issueCredential({
      roomId,
      peerId,
      principal,
      ...(companion && { companion }),
      ...(call && { call })
    });
    if (gate.status !== 'issued') return { status: gate.status, admission: null };
    const { credential } = gate;

    const tokenTtl = companion
      ? companion.sliding
        ? SLIDING_COMPANION_TOKEN_TTL_SECONDS
        : Math.max(1, Math.ceil((companion.expiresAt - Date.now()) / 1000))
      : ttlSeconds;
    const token = companion
      ? await signCompanion(apiKey, apiSecret, { roomId, livekitRoom, peerId, id: companion.id }, tokenTtl)
      : await signParticipant(
          { apiKey, apiSecret, roomId, livekitRoom, peerId, name, surface, canPublishMicrophone, canPublishScreen },
          tokenTtl
        );
    const publicUrl = new URL(normalizeLiveKitServerUrl(gateUrl));
    publicUrl.searchParams.set('vr_gate_credential', credential.value);
    return {
      status: 'issued',
      admission: {
        gateCredentialId: credential.id,
        room: livekitRoom,
        token,
        ttlSeconds: tokenTtl,
        url: publicUrl.toString()
      }
    };
  }

  async function refreshCompanionToken(input: CompanionTokenInput): Promise<string | null> {
    if (!apiKey || !apiSecret) return null;
    return signCompanion(apiKey, apiSecret, input, SLIDING_COMPANION_TOKEN_TTL_SECONDS);
  }

  return Object.freeze({ issueAdmission, refreshCompanionToken });
}

type CompanionTokenInput = { roomId: string; livekitRoom: string; peerId: string; id: string };

function signCompanion(apiKey: string, apiSecret: string, input: CompanionTokenInput, ttl: number): Promise<string> {
  const { roomId, livekitRoom, peerId, id } = input;
  const token = new AccessToken(apiKey, apiSecret, {
    identity: nativeVoiceIdentity(peerId, id),
    metadata: JSON.stringify({ roomId }),
    attributes: { [NATIVE_VOICE_LEASE_ATTRIBUTE]: id },
    ttl
  });
  token.addGrant({
    canPublish: false,
    canPublishData: false,
    canPublishSources: [],
    canSubscribe: true,
    canUpdateOwnMetadata: false,
    hidden: true,
    room: livekitRoom,
    roomJoin: true
  });
  return token.toJwt();
}

function signParticipant(
  input: {
    apiKey: string;
    apiSecret: string;
    roomId: string;
    livekitRoom: string;
    peerId: string;
    name: string;
    surface: RoomSurface;
    canPublishMicrophone: boolean;
    canPublishScreen: boolean;
  },
  ttl: number
): Promise<string> {
  const { apiKey, apiSecret, roomId, livekitRoom, peerId, name, surface, canPublishMicrophone, canPublishScreen } =
    input;
  const token = new AccessToken(apiKey, apiSecret, {
    identity: peerId,
    metadata: JSON.stringify({ roomId }),
    // Meet distributes display names through its in-memory API roster.
    name: surface === 'meet' ? '' : name,
    ttl
  });
  const canPublishSources = liveKitPublishSources(surface, {
    microphone: canPublishMicrophone,
    screen: canPublishScreen
  });
  // Chat, reactions and presence travel over the API, never LiveKit data packets.
  token.addGrant({
    canPublish: canPublishSources.length > 0,
    canPublishData: false,
    canPublishSources,
    canSubscribe: true,
    room: livekitRoom,
    roomJoin: true
  });
  return token.toJwt();
}

export type LiveKitCredentialProvider = ReturnType<typeof createLiveKitCredentialProvider>;

export { createLiveKitCredentialProvider };
