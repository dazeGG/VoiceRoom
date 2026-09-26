// The LiveKit credential side of admission: the gate credential boundary
// (issued, verified and revoked against the room store) and the provider that
// hands a joining peer its LiveKit token and gate credential.

import type { createRoomStore } from '../../lib/room-store.ts';
import { createCredentialBoundaryService } from './credential-boundary.service.ts';
import { createLiveKitCredentialProvider } from './livekit-credential-provider.ts';

type RoomStore = ReturnType<typeof createRoomStore>;
type LiveKitConfig = { enabled: boolean; apiKey: string; apiSecret: string; gateUrl: string };

/** The boundary, or null without a 32-byte gate secret or a store that can hold gate credentials. */
export function createGateCredentialBoundary({
  store,
  secret,
  credentialTtlSeconds
}: {
  store: RoomStore;
  secret: string;
  credentialTtlSeconds: number;
}) {
  if (secret.length < 32) return null;
  if (
    typeof store.getLiveKitGatePrincipalEpoch !== 'function' ||
    typeof store.createLiveKitGateCredential !== 'function' ||
    typeof store.verifyLiveKitGateCredential !== 'function' ||
    (typeof store.revokeLiveKitGatePrincipal !== 'function' && typeof store.revokeLiveKitGatePeer !== 'function')
  ) {
    return null;
  }
  return createCredentialBoundaryService({ roomStore: store, secret, credentialTtlMs: credentialTtlSeconds * 1000 });
}

/** The provider, or null while LiveKit is off or there is no boundary. */
export function createLiveKitProvider({
  boundary,
  livekit,
  tokenTtlSeconds
}: {
  boundary: ReturnType<typeof createGateCredentialBoundary>;
  livekit: LiveKitConfig;
  tokenTtlSeconds: number;
}) {
  if (!boundary || !livekit.enabled) return null;
  return createLiveKitCredentialProvider({
    apiKey: livekit.apiKey,
    apiSecret: livekit.apiSecret,
    boundary,
    gateUrl: livekit.gateUrl,
    tokenTtlSeconds
  });
}
