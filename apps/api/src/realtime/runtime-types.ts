import type { GateCredentialRepository } from '../domains/admission/gate-credential.repository.ts';
import type { RoomChatRepository } from '../domains/messaging/room-chat.repository.ts';
import type { ServerMuteRepository } from '../domains/moderation/room-ban.repository.ts';
import type { PeerIdentityRepository } from '../domains/rooms/peer-identity.repository.ts';
import type { RoomAccessRepository } from '../domains/rooms/room-access.repository.ts';
import type { RoomRepository } from '../domains/rooms/room.repository.ts';
import type { PresenceRoom as RosterRoom, RosterPeer } from './room-presence.ts';

// The in-memory records the room runtime and its reconnect leases share:
// presence peers and rooms, and the lease that holds a dropped peer's seat.

/** A voice peer on the in-memory roster. */
export type Peer = RosterPeer;
/** A room's in-memory roster. */
export type PresenceRoom = RosterRoom;
export type Timer = ReturnType<typeof globalThis.setTimeout> | number;
export type VoiceTarget = { roomId: string; peerId: string; sessionToken?: string; transportId?: string };
export type FinalizeContext = {
  roomId: string;
  peerId: string;
  peer: Peer | null;
  reason: string;
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
  transportId: string;
  generation: number;
  deadline: number;
  state: LeaseState;
  timer: Timer | null;
  finalizerPromise: Promise<FinalizeResult> | null;
  finalizeCallbacks: FinalizePeer[];
  terminalReason: string;
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

export type RuntimeLogger = {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

/** Lets the process exit while only this timer is pending. */
export function unrefTimer(timer: Timer | null): void {
  if (timer && typeof timer === 'object') timer.unref?.();
}
