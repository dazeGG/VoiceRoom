import type { SessionUser } from '../../app/context.ts';
import { DomainError } from '../../platform/http/domain-error.ts';
import {
  revokeIssuedAdmission,
  type AdmissionPeer,
  type AdmissionStore,
  type CredentialBoundary
} from './admission.service.ts';
import type { LiveKitCredentialProvider } from './livekit-credential-provider.ts';

export function createCallVoiceAdmission(deps: {
  currentPeer(roomId: string, peerId: string): AdmissionPeer | null;
  store(): Pick<AdmissionStore, 'normalizeGatePrincipal' | 'isRoomServerMuted'>;
  provider(): Pick<LiveKitCredentialProvider, 'issueAdmission'> | null;
  boundary(): CredentialBoundary | null;
  roomName(roomId: string): string;
  logger: Parameters<typeof revokeIssuedAdmission>[0]['log'];
  recordRevokeFailure(this: void): void;
}) {
  return async (roomId: string, peerId: string, user: SessionUser, { e2ee }: { e2ee: boolean }) => {
    const seat = deps.currentPeer(roomId, peerId);
    if (!seat || seat.accountUserId !== user.id) throw new DomainError('call_not_found', 404, 'Call seat not found');
    const provider = deps.provider();
    if (!provider) throw new DomainError('livekit_gate_unavailable', 503, 'LiveKit admission is unavailable');
    const store = deps.store();
    const principal = store.normalizeGatePrincipal({ accountUserId: user.id, guestPrincipalId: '', roomId });
    if (!principal) throw new DomainError('livekit_gate_unavailable', 503, 'LiveKit admission is unavailable');
    const muted = await store.isRoomServerMuted({ roomId, principal });
    const current = () => deps.currentPeer(roomId, peerId)?.transportId === seat.transportId;
    if (!current()) throw new DomainError('call_not_found', 404, 'Call seat not found');
    const result = await provider.issueAdmission({
      roomId,
      peerId,
      principal,
      call: true,
      ...(e2ee && { e2ee: true as const }),
      canPublishMicrophone: !muted,
      name: user.displayName || user.login || '',
      livekitRoom: deps.roomName(roomId)
    });
    if (result.status !== 'issued')
      throw new DomainError('livekit_gate_credential_unavailable', 503, 'LiveKit admission is unavailable');
    if (!current()) {
      await revokeIssuedAdmission({
        boundary: deps.boundary(),
        credentialId: result.admission.gateCredentialId,
        principal,
        roomId,
        log: deps.logger,
        recordFailure: deps.recordRevokeFailure
      });
      throw new DomainError('call_not_found', 404, 'Call seat not found');
    }
    return result.admission;
  };
}
