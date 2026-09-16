// Which next step a room offers: a guest is asked to create an account, and an
// account in a desktop browser is offered the desktop app. Only one shows at a
// time, in the same place, so registering swaps one for the other.
export type RoomCtaKind = 'account' | 'app';

export interface RoomCtaInput {
  /** Connected to voice in this room. */
  joined: boolean;
  /** Nobody is signed in on this page. */
  guest: boolean;
  /** A desktop browser on Windows or macOS, outside the desktop app itself. */
  appAvailable: boolean;
  hasUsedDesktopApp: boolean;
  /** Closed for this visit to the room. */
  dismissed: boolean;
}

export function resolveRoomCta(input: RoomCtaInput): RoomCtaKind | null {
  if (!input.joined || input.dismissed) return null;
  if (input.guest) return 'account';
  if (input.appAvailable && !input.hasUsedDesktopApp) return 'app';
  return null;
}

export interface AppPromptInput {
  appAvailable: boolean;
  hasUsedDesktopApp: boolean;
  appPromptSeen: boolean;
  /** A sign-in question or the what's-new story is on screen. */
  otherDialogOpen: boolean;
  /** Voice is joining or connected; a modal would cover the call. */
  voiceActive: boolean;
}

/** The one-time post-registration app prompt waits for a quiet lobby. */
export function shouldOpenAppPrompt(input: AppPromptInput): boolean {
  return input.appAvailable
    && !input.hasUsedDesktopApp
    && !input.appPromptSeen
    && !input.otherDialogOpen
    && !input.voiceActive;
}
