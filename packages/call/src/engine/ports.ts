import { getActivePinia, type Pinia } from 'pinia';
import type { CallFeedbackCall } from '@voiceroom/shared/contracts/feedback';
import type { AppWindowState } from '@voiceroom/shared/contracts/realtime';
import type { PlatformClass } from '@voiceroom/shared/platform-class';
import type { Logger, LogLevel } from '@voiceroom/ui/log';
import type { VoiceAssetUrls } from '../voice-assets';
import type { DesktopCapabilities } from './desktop-capabilities';
import type { PeerSession } from './core/types';
import type { CallTransport } from './transport';

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
  credentials(roomId: string): PeerSession;
  rotateCredentials(roomId: string): PeerSession;
  /** The account an embedded room already knows, entered without a round trip; null otherwise. */
  knownEntry(input: { embedded: boolean }): EntryIdentity | null;
  /** A fresh session check, for a standalone room or an embedded one without a known account. */
  verifyEntry(): Promise<EntryIdentity>;
}

export interface HostHooks {
  createRoom(): Promise<string>;
  isDeletingRoom(): boolean;
  closeParticipantMenu(peerId?: string): void;
  showLeaveScreen(input: { roomId: string; isStatic: boolean; guest: boolean }): void;
  setCallActive(active: boolean): void;
  leaveMembership(roomId: string): Promise<boolean>;
  suppressCuePlayback(): boolean;
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

export interface CallStorage {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}

export interface CallDiagnostics {
  logger(namespace: string): Logger;
  report(reason: string, level?: LogLevel): Promise<boolean>;
  installGlobalErrorCapture(): void;
  buildVersion(): string;
  reportJoinOutcome(input: {
    outcome: 'success' | 'failure' | 'cancel';
    elapsedMs: number;
    stage: 'started' | 'microphone' | 'token' | 'connect' | 'publish';
    roomId?: string;
    reportedGuestId?: string;
  }): void;
}

export interface PlatformPort {
  policy(): Readonly<{ roomClientAllowed: boolean; desktopAllowed: boolean; platformClass: PlatformClass }>;
  isVisible(): boolean;
  windowState?(): AppWindowState;
  onVisibilityChange(listener: (visible: boolean) => void): () => void;
  prepareRoomNavigation(): void;
  navigateToRoom(roomId: string, method?: 'assign'): void;
  goHome(): void;
  forceRelay(): boolean;
  traceLiveKit(): boolean;
  desktop: DesktopCapabilities;
}

export interface CallPorts {
  identity: IdentityPort;
  storage: CallStorage;
  transport: CallTransport;
  assets: VoiceAssetUrls;
  diagnostics: CallDiagnostics;
  /** Browser/embed policy, fixed for the lifetime of the installed host. */
  mediaPolicy: Readonly<{ camera: boolean }>;
  host: HostHooks;
  feedback: FeedbackPort;
  platform: PlatformPort;
}

let installed: CallPorts | undefined;
let installedPinia: Pinia | undefined;

/** Install after activating Pinia, before runtime actions (not on route mount). */
export function installCallPorts(ports: CallPorts, pinia = getActivePinia()): () => void {
  installed = ports;
  installedPinia = pinia;
  return () => {
    if (installed === ports) {
      installed = undefined;
      installedPinia = undefined;
    }
  };
}

export function getCallPinia(): Pinia | undefined {
  return installedPinia;
}

export function getInstalledCallPorts(): CallPorts | undefined {
  return installed;
}

export function getCallPorts(): CallPorts {
  if (!installed)
    throw new Error('Call ports are not installed. Install call ports before invoking room runtime actions.');
  return installed;
}
