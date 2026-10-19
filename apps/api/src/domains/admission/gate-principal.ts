// The identity a LiveKit gate credential is issued to: the account for a
// signed-in peer, the room-scoped guest identity otherwise.

import type { GatePrincipal } from './admission.service.ts';

export interface GatePrincipalPeer {
  accountUserId?: string | null;
  gateGuestPrincipalId?: string | null;
}

export interface GatePrincipalStore {
  normalizeGatePrincipal(input: {
    accountUserId: string | null;
    guestPrincipalId: string;
    roomId: string;
  }): GatePrincipal | null;
}

export function isGatePrincipal(value: unknown): value is GatePrincipal {
  return (
    typeof value === 'object' &&
    value !== null &&
    'principalType' in value &&
    (value.principalType === 'account' || value.principalType === 'guest') &&
    'principalId' in value &&
    typeof value.principalId === 'string' &&
    value.principalId.trim().length > 0
  );
}

export function gatePrincipalForPeer(
  store: GatePrincipalStore,
  roomId: string,
  peer: GatePrincipalPeer
): GatePrincipal | null {
  return store.normalizeGatePrincipal({
    accountUserId: peer.accountUserId || null,
    guestPrincipalId: peer.gateGuestPrincipalId || '',
    roomId
  });
}
