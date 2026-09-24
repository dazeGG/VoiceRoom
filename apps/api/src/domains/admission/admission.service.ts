// Media admission: who gets a LiveKit JWT plus gate credential for a room.
// Returns a refusal reason instead of an HTTP status so the route decides how
// each reason is spelled for clients; unexpected failures throw, after the
// credential that was already issued has been revoked.

import type { Logger } from 'pino';
import { LOG_EVENTS } from '../../lib/log-events.ts';
import { tokensMatch } from '../../platform/crypto/tokens-match.ts';
import type { LiveKitConfig } from './livekit-config.ts';

export type GatePrincipal = {
  principalType: 'account' | 'guest';
  principalId: string;
};

export interface Admission {
  gateCredentialId?: string;
  room?: string;
  token?: string;
  ttlSeconds?: number;
  url?: string;
}

type IssueResult = { status: 'issued'; admission: Admission } | { status: string; admission: null };

export interface CredentialProvider {
  issueAdmission(input: {
    canPublishMicrophone: boolean;
    livekitRoom: string;
    name: string;
    peerId: string;
    principal: GatePrincipal;
    roomId: string;
  }): Promise<IssueResult>;
}

export interface CredentialBoundary {
  revokeCredential(input: { credentialId: string | undefined; roomId: string; principal: GatePrincipal }): Promise<{ status?: string } | undefined>;
  revokePrincipal(input: { roomId: string; principal: GatePrincipal }): Promise<unknown>;
}

export interface AdmissionStore {
  getOrCreatePeerIdentity(input: {
    roomId: string;
    peerId: string;
    sessionToken: string;
    displayName: string;
    avatarColorKey: string;
  }): Promise<{ status: string; identity?: { id?: string } | null } | null>;
  normalizeGatePrincipal(input: { accountUserId: string | null; guestPrincipalId: string; roomId: string }): GatePrincipal | null;
  isRoomServerMuted?(input: { roomId: string; principal: GatePrincipal }): Promise<boolean>;
}

export interface MembershipServices {
  service: {
    persistSuccessfulAdmission(input: { roomId: string; userId: string; ip: string; admissionSucceeded: boolean }): Promise<{ status: string }>;
  };
}

export interface AdmissionDeps {
  livekitConfig(): LiveKitConfig;
  credentialProvider(): CredentialProvider | null;
  credentialBoundary(): CredentialBoundary | null;
  store(): AdmissionStore;
  roomExists(roomId: string): Promise<boolean>;
  findRoomBan(roomId: string, userId: string | undefined, ip: string): Promise<unknown>;
  waitForRosterPeer(roomId: string, peerId: string): Promise<{ sessionToken?: string } | null>;
  memberships(): MembershipServices | null;
  roomName(roomId: string): string;
  recordRevokeFailure(): void;
}

export type RefusalReason =
  | 'invalid_request'
  | 'room_not_found'
  | 'room_banned'
  | 'not_in_room'
  | 'invalid_session'
  | 'livekit_unconfigured'
  | 'livekit_gate_unconfigured'
  | 'livekit_gate_principal_unavailable'
  | 'server_mute_unavailable'
  | 'membership_unavailable'
  | 'livekit_gate_unavailable'
  | 'livekit_gate_credential_unavailable'
  | 'membership_persist_failed';

export type AdmissionResult = { status: 'issued'; admission: Admission } | { status: 'refused'; reason: RefusalReason };

export interface AdmissionRequest {
  roomId: string;
  peerId: string;
  sessionToken: string;
  name: string;
  user: { id?: string; avatarColorKey?: string } | null;
  clientIp: string;
  log: Pick<Logger, 'warn' | 'error'>;
}

// Every refusal to admit a peer to the SFU is recorded with the code the
// client is about to see. A call that "does not connect" is otherwise
// indistinguishable in the logs from one that was never attempted.
function logDenied(log: Pick<Logger, 'warn'>, fields: { roomId: string; peerId: string; code: string; err?: unknown }): void {
  log.warn({ evt: LOG_EVENTS.LIVEKIT_ADMISSION_DENIED, roomId: fields.roomId, peerId: fields.peerId, code: fields.code, err: fields.err || undefined }, 'LiveKit admission denied');
}

/**
 * Revokes a credential that was issued but must not be used. If the cleanup
 * itself fails, the failure is metered and logged, and the original cause (if
 * any) is kept next to it so neither is lost.
 */
export async function revokeIssuedAdmission({
  boundary,
  cause,
  credentialId,
  principal,
  recordFailure,
  log,
  roomId
}: {
  boundary: CredentialBoundary | null;
  cause?: unknown;
  credentialId: string | undefined;
  principal: GatePrincipal;
  recordFailure: () => void;
  log: Pick<Logger, 'error'> | undefined;
  roomId: string;
}): Promise<void> {
  try {
    const revoked = await boundary?.revokeCredential({ credentialId, roomId, principal });
    if (revoked?.status !== 'revoked') {
      throw Object.assign(new Error('Issued admission credential cleanup was refused'), { code: 'credential_revoke_cleanup_refused' });
    }
  } catch (cleanupError) {
    recordFailure();
    log?.error({ evt: LOG_EVENTS.LIVEKIT_ADMISSION_REVOKED, credentialId, roomId, code: 'credential_revoke_cleanup_failed', err: cleanupError }, 'issued admission credential cleanup failed');
    if (cause) throw new AggregateError([cause, cleanupError], 'Admission persistence and credential cleanup both failed', { cause });
    throw cleanupError;
  }
}

export function createAdmissionService(deps: AdmissionDeps) {
  const refuse = (reason: RefusalReason): AdmissionResult => ({ status: 'refused', reason });

  async function admit(request: AdmissionRequest): Promise<AdmissionResult> {
    const { roomId, peerId, sessionToken, name, user, clientIp, log } = request;
    const livekit = deps.livekitConfig();

    if (!(await deps.roomExists(roomId))) return refuse('room_not_found');
    if (await deps.findRoomBan(roomId, user?.id, clientIp)) return refuse('room_banned');

    // Media admission belongs to a peer the room roster already knows. Without
    // this a caller holding only the room id could subscribe to every voice and
    // screen share while staying invisible — and therefore un-kickable. The
    // client sends the realtime join just before asking for a token, so the
    // roster lookup waits a moment for that join to land.
    const rosterPeer = await deps.waitForRosterPeer(roomId, peerId);
    if (!rosterPeer) {
      logDenied(log, { roomId, peerId, code: 'not_in_room' });
      return refuse('not_in_room');
    }
    if (!tokensMatch(rosterPeer.sessionToken, sessionToken)) return refuse('invalid_session');

    const provider = deps.credentialProvider();
    if (!provider && !livekit.enabled) return refuse('livekit_unconfigured');
    if (!provider && (!livekit.gateSecret || livekit.gateSecret.length < 32)) {
      logDenied(log, { roomId, peerId, code: 'livekit_gate_unavailable' });
      return refuse('livekit_gate_unconfigured');
    }

    const store = deps.store();
    // Null only if the identity row vanished mid-transaction.
    const identity = (await store.getOrCreatePeerIdentity({ roomId, peerId, sessionToken, displayName: name, avatarColorKey: user?.avatarColorKey || '' }))!;
    if (identity.status === 'token_mismatch') return refuse('invalid_session');
    const principal = store.normalizeGatePrincipal({ accountUserId: user?.id || null, guestPrincipalId: identity.identity?.id || '', roomId });
    if (!principal) {
      logDenied(log, { roomId, peerId, code: 'livekit_gate_principal_unavailable' });
      return refuse('livekit_gate_principal_unavailable');
    }

    const serverMuteLookup = async (): Promise<boolean> => {
      if (typeof store.isRoomServerMuted !== 'function') throw new Error('Server mute authority is unavailable');
      return store.isRoomServerMuted({ roomId, principal });
    };
    let serverMuted: boolean;
    try {
      serverMuted = await serverMuteLookup();
    } catch (error) {
      logDenied(log, { roomId, peerId, code: 'server_mute_unavailable', err: error });
      return refuse('server_mute_unavailable');
    }

    const memberships = user?.id ? deps.memberships() : null;
    if (user?.id && !memberships) return refuse('membership_unavailable');

    if (!provider) {
      logDenied(log, { roomId, peerId, code: 'livekit_gate_unavailable' });
      return refuse('livekit_gate_unavailable');
    }

    const issue = () => provider.issueAdmission({ canPublishMicrophone: !serverMuted, livekitRoom: deps.roomName(roomId), name, peerId, principal, roomId });
    const revoke = (credentialId: string | undefined, cause?: unknown) => revokeIssuedAdmission({
      boundary: deps.credentialBoundary(),
      cause,
      credentialId,
      principal,
      recordFailure: deps.recordRevokeFailure,
      log,
      roomId
    });

    let issued = await issue();
    if (issued.status !== 'issued' || !issued.admission) {
      logDenied(log, { roomId, peerId, code: 'livekit_gate_credential_unavailable' });
      return refuse('livekit_gate_credential_unavailable');
    }
    let admission: Admission = issued.admission;

    // A server mute that lands between the lookup and the issue would leave the
    // microphone in the token; re-check and reissue if the answer changed.
    try {
      const currentServerMuted = await serverMuteLookup();
      if (currentServerMuted !== serverMuted) {
        await revoke(admission.gateCredentialId);
        serverMuted = currentServerMuted;
        issued = await issue();
        if (issued.status !== 'issued' || !issued.admission) return refuse('livekit_gate_credential_unavailable');
        admission = issued.admission;
      }
    } catch (error) {
      await revoke(admission.gateCredentialId, error);
      throw error;
    }

    if (await deps.findRoomBan(roomId, user?.id, clientIp)) {
      logDenied(log, { roomId, peerId, code: 'room_banned' });
      await deps.credentialBoundary()?.revokePrincipal({ roomId, principal });
      return refuse('room_banned');
    }

    if (user?.id && memberships) {
      let persisted: { status: string };
      try {
        persisted = await memberships.service.persistSuccessfulAdmission({ roomId, userId: user.id, ip: clientIp, admissionSucceeded: true });
      } catch (error) {
        await revoke(admission.gateCredentialId, error);
        throw error;
      }
      if (persisted.status !== 'active') {
        await revoke(admission.gateCredentialId);
        return refuse(persisted.status === 'banned' ? 'room_banned' : 'membership_persist_failed');
      }
    }

    return { status: 'issued', admission };
  }

  // Every gate credential issued before a server mute was paired with a JWT
  // that still grants the microphone. Revoke them so a reconnect has to fetch a
  // fresh admission, which the durable mute row keeps microphone-free.
  async function revokeForServerMute({ roomId, peerId, principal, log }: { roomId: string; peerId: string; principal: GatePrincipal; log: Pick<Logger, 'error'> }): Promise<void> {
    const boundary = deps.credentialBoundary();
    if (!boundary) return;
    try {
      await boundary.revokePrincipal({ roomId, principal });
    } catch (error) {
      // The live SFU permission is still narrowed; only a later reconnect with
      // the old admission would regain the microphone.
      deps.recordRevokeFailure();
      log.error({ evt: LOG_EVENTS.LIVEKIT_MUTE_FAILED, roomId, peerId, err: error }, 'failed to revoke gate credentials for a server mute');
    }
  }

  return { admit, revokeForServerMute };
}

export type AdmissionService = ReturnType<typeof createAdmissionService>;
