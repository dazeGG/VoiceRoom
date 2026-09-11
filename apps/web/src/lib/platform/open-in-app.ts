export const APP_LINK_SCHEME = 'voiceroom';
export const DEV_APP_LINK_SCHEME = 'voiceroom-dev';

const IN_APP_NAVIGATION_KEY = 'voice-room:in-app-room-navigation';
let inAppNavigation: boolean | null = null;

/**
 * Marks a reload onto /r/:id that the web app started itself (joining by code,
 * a room redirect), so the next page joins in the browser instead of offering
 * the desktop app for a link the user never clicked.
 */
export function markInAppRoomNavigation(): void {
  try {
    sessionStorage.setItem(IN_APP_NAVIGATION_KEY, '1');
  } catch {
    // Without storage the page offers the app once more; nothing breaks.
  }
}

/** Reads the mark once per page load; every caller on that page gets the same answer. */
export function consumeInAppRoomNavigation(): boolean {
  if (inAppNavigation !== null) return inAppNavigation;
  try {
    inAppNavigation = sessionStorage.getItem(IN_APP_NAVIGATION_KEY) === '1';
    sessionStorage.removeItem(IN_APP_NAVIGATION_KEY);
  } catch {
    inAppNavigation = false;
  }
  return inAppNavigation;
}

const PRODUCTION_HOSTS = new Set(['voiceroom.ru', 'www.voiceroom.ru']);
const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{3,48}$/;

export interface OpenInAppSignals {
  desktopBridge: boolean;
  userAgent?: string;
  mobile?: boolean;
  maxTouchPoints?: number;
}

/** Production pages open the released app; every other host targets dev builds. */
export function resolveAppLinkScheme(hostname: string): string {
  return PRODUCTION_HOSTS.has(String(hostname || '').toLowerCase()) ? APP_LINK_SCHEME : DEV_APP_LINK_SCHEME;
}

export function buildAppRoomLink(roomId: string, hostname: string): string | null {
  if (!ROOM_ID_PATTERN.test(roomId)) return null;
  return `${resolveAppLinkScheme(hostname)}://r/${roomId}`;
}

/**
 * The desktop app exists for Windows and macOS only. Touch Macs are iPads in
 * desktop mode, and the app itself never offers to open itself.
 */
export function shouldOfferOpenInApp(signals: OpenInAppSignals): boolean {
  if (signals.desktopBridge || signals.mobile === true) return false;
  const userAgent = signals.userAgent || '';
  if (/Windows NT/.test(userAgent)) return true;
  return /Macintosh|Mac OS X/.test(userAgent) && (signals.maxTouchPoints ?? 0) <= 1;
}

export function readOpenInAppSignals(): OpenInAppSignals {
  if (typeof window === 'undefined') return { desktopBridge: false };
  const nav = window.navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return {
    desktopBridge: Boolean(window.voiceRoomRuntime?.isDesktop),
    maxTouchPoints: nav.maxTouchPoints,
    mobile: typeof nav.userAgentData?.mobile === 'boolean' ? nav.userAgentData.mobile : undefined,
    userAgent: nav.userAgent
  };
}

/**
 * Hands the link to the OS. Browsers without a registered handler silently
 * ignore it; Firefox would replace the page with an error, so it gets a hidden
 * frame instead of a top-level navigation.
 */
export function launchAppLink(url: string, target: { document: Document; location: Location; navigator: Navigator } = window): void {
  if (/Firefox\//.test(target.navigator.userAgent)) {
    const frame = target.document.createElement('iframe');
    frame.hidden = true;
    frame.src = url;
    target.document.body.appendChild(frame);
    setTimeout(() => frame.remove(), 2000);
    return;
  }
  target.location.href = url;
}
