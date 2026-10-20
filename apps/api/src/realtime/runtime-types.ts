import type { PeerLeaveReason } from '@voice-room/shared/contracts/realtime';
import type { GateCredentialRepository } from '../domains/admission/gate-credential.repository.ts';
import type { RoomChatRepository } from '../domains/messaging/room-chat.repository.ts';
import type { ServerMuteRepository } from '../domains/moderation/room-ban.repository.ts';
import type { PeerIdentityRepository } from '../domains/rooms/peer-identity.repository.ts';
import type { RoomAccessRepository } from '../domains/rooms/room-access.repository.ts';
import type { RoomRepository } from '../domains/rooms/room.repository.ts';
import type { Logger, Timer } from '../platform/types.ts';
import type { PresenceRoom as RosterRoom, RosterPeer } from './room-presence.ts';

// The in-memory records the room runtime and its reconnect leases share:
// presence peers and rooms, and the lease that holds a dropped peer's seat.

/** A voice peer on the in-memory roster. */
export type Peer = RosterPeer;
/** A room's in-memory roster. */
export type PresenceRoom = RosterRoom;
export type VoiceTarget = {
  roomId: string;
  peerId: string;
  sessionToken?: string | undefined;
  transportId?: string | undefined;
};
/** Why a lease ends: how the peer left, or the moderation that evicted it. */
export type LeaseReason = PeerLeaveReason | 'room.kicked' | 'room.banned';
/** How a peer whose lease ended left its seat, as room.peer.left tells the room. */
export function leaveReasonOf(reason: LeaseReason): PeerLeaveReason {
  if (reason === 'room.kicked') return 'kicked';
  if (reason === 'room.banned') return 'banned';
  return reason;
}
export type FinalizeContext = {
  roomId: string;
  peerId: string;
  peer: Peer | null;
  reason: LeaseReason;
  ownershipFinalized: boolean;
};
export type FinalizePeer = (context: FinalizeContext) => Promise<{ finalized?: boolean } | void | undefined>;
export type FinalizeResult = { ok: true; finalized: boolean };
export type LeaseState =
  | 'pending'
  | 'claimed-by-replacement'
  | 'finalizing-expiry'
  | 'terminal-finalizing'
  | 'finalizer-failed'
  | 'terminal-finalizer-failed'
  | 'terminal';
export type LeaseRecord = {
  key: string;
  roomId: string;
  peerId: string;
  sessionToken: string;
  /** The seat's transport when the lease began; undefined if it carried no id. */
  transportId: string | undefined;
  generation: number;
  deadline: number;
  state: LeaseState;
  timer: Timer | null;
  finalizerPromise: Promise<FinalizeResult> | null;
  finalizeCallbacks: FinalizePeer[];
  terminalReason: LeaseReason | '';
  terminalAtJoinSequence: number;
  claimRequestSequence: number;
  finalizerErrorCode: string;
  disconnected: boolean;
  peer: Peer;
};
export type LeaseClaim =
  | { state: 'none'; record: null }
  | { state: 'claimed' | 'finalizing' | 'busy' | 'failed-finalizer' | 'terminal' | LeaseState; record: LeaseRecord };
export type FinalizeError = Error & { ownershipFinalized?: boolean; rollbackTerminal?: boolean; code?: string };

type RoomRepositories = RoomRepository &
  RoomAccessRepository &
  RoomChatRepository &
  PeerIdentityRepository &
  GateCredentialRepository &
  ServerMuteRepository;

export type RuntimeRoomStore = Pick<
  RoomRepositories,
  | 'getRoom'
  | 'listMessages'
  | 'getOrCreatePeerIdentity'
  | 'listVisibleRoomsForUser'
  | 'listSummaryRecipientUserIds'
  | 'markRoomActive'
> &
  Partial<
    Pick<
      RoomRepositories,
      | 'revokeLiveKitGatePeer'
      | 'getRoomUnreadCount'
      | 'listNotificationRecipientUserIds'
      | 'isRoomServerMuted'
      | 'normalizeGatePrincipal'
    >
  >;

export type RuntimeLogger = Pick<Logger, 'info' | 'warn' | 'error'>;

/** Lets the process exit while only this timer is pending. */
export function unrefTimer(timer: Timer | null): void {
  if (timer && typeof timer === 'object') timer.unref?.();
}
