import type { CallFeedbackCall } from '@voice-room/shared/contracts/feedback';
import type { PlatformClass } from '@voice-room/shared/platform-class';

export type CallProfile = Readonly<{
  displayName: string;
  avatarAccent: string;
  avatarColorKey: string;
  avatarUrl: string;
}>;

export type CallIdentity = Readonly<{
  kind: 'account' | 'guest';
  profile: CallProfile | null;
  feedbackGuestId?: string;
}>;

export type EntryIdentity = Readonly<{
  identity: CallIdentity;
  /** The session guard only; the caller retains its existing room-id check. */
  isCurrent(): boolean;
}>;

export interface IdentityPort {
  current(): CallIdentity;
  /** The account an embedded room already knows, entered without a round trip; null otherwise. */
  knownEntry(input: { embedded: boolean }): EntryIdentity | null;
  /** A fresh session check, for a standalone room or an embedded one without a known account. */
  verifyEntry(): Promise<EntryIdentity>;
}

export interface HostHooks {
  /** Fire-and-forget after an account enters; never delays entry. */
  entered(input: {
    roomId: string;
    isStatic: boolean;
    /** The entry's session and room are still the ones this call is entering. */
    isCurrent: () => boolean;
    /** Tell the shell the account's room list changed. */
    roomsChanged: () => void;
  }): void;
}

export interface FeedbackPort {
  drop(): void;
  finished(call: CallFeedbackCall | null): void;
  offer(): void;
}

/** Transitional web page state; PR3 moves ownership into the call package. */
export interface CallPageState {
  screen: '' | 'start' | 'checking' | 'room' | 'entry-error' | 'not-found' | 'moderation';
  screenView: boolean;
  stripCollapsed: boolean;
  stageSummary: '' | 'hidden';
  desktopScreenFullscreen: boolean;
}

export interface CallPagePort {
  read(): Readonly<CallPageState>;
  patch(state: Partial<CallPageState>): void;
}

export interface PlatformPort {
  policy(): Readonly<{ roomClientAllowed: boolean; desktopAllowed: boolean; platformClass: PlatformClass }>;
  isVisible(): boolean;
  onVisibilityChange(listener: (visible: boolean) => void): () => void;
  prepareRoomNavigation(): void;
  navigateToRoom(roomId: string, method?: 'assign'): void;
  goHome(): void;
  page: CallPagePort;
}

export interface CallPorts {
  identity: IdentityPort;
  host: HostHooks;
  feedback: FeedbackPort;
  platform: PlatformPort;
}

let installed: CallPorts | undefined;

/** Install after activating Pinia, before runtime actions (not on route mount). */
export function installCallPorts(ports: CallPorts): () => void {
  installed = ports;
  return () => {
    if (installed === ports) installed = undefined;
  };
}

export function getCallPorts(): CallPorts {
  if (!installed)
    throw new Error('Call ports are not installed. Install call ports before invoking room runtime actions.');
  return installed;
}
