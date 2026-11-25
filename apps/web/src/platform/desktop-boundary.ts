import { classifyPlatformPolicy, type PlatformPolicy, type PlatformSignals } from '@voiceroom/shared/platform-class';

// Vite has no `$app/environment`: the runtime says whether this is a browser, as in shared/log.ts.
const browser = typeof window !== 'undefined' && typeof document !== 'undefined';

const BOUNDARY_CLASS_PREFIX = 'desktop-boundary--';
const PLATFORM_CLASS_PREFIX = 'platform--';

let cachedPolicy: PlatformPolicy | null = null;

function hasDesktopBridge(): boolean {
  if (!browser) return false;
  return Boolean(
    window.voiceRoomRuntime?.isDesktop ||
    window.voiceRoomDesktopCapture ||
    window.voiceRoomDesktopAudio ||
    window.voiceRoomDesktopHotkeys
  );
}

function readPlatformSignals(): PlatformSignals {
  if (!browser) return {};

  const nav = window.navigator;
  return {
    desktopBridge: hasDesktopBridge(),
    userAgentDataMobile: typeof nav.userAgentData?.mobile === 'boolean' ? nav.userAgentData.mobile : undefined,
    userAgent: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints
  };
}

// One class of each kind at a time on <html>: the old one goes before the new one comes.
function setRootClass(prefix: string, value: string): void {
  const { classList } = document.documentElement;
  for (const name of [...classList]) {
    if (name.startsWith(prefix)) classList.remove(name);
  }
  classList.add(`${prefix}${value}`);
}

function writeBoundaryClasses(policy: PlatformPolicy): void {
  if (!browser) return;
  setRootClass(BOUNDARY_CLASS_PREFIX, policy.desktopAllowed ? 'allowed' : 'blocked');
  setRootClass(PLATFORM_CLASS_PREFIX, policy.platformClass);
}

export function resolveDesktopBoundaryPolicy(): PlatformPolicy {
  cachedPolicy = classifyPlatformPolicy(readPlatformSignals());
  return cachedPolicy;
}

export function applyDesktopBoundaryToDocument(): PlatformPolicy {
  const policy = resolveDesktopBoundaryPolicy();
  writeBoundaryClasses(policy);
  return policy;
}

export function getDesktopBoundaryPolicy(): PlatformPolicy {
  return cachedPolicy ?? resolveDesktopBoundaryPolicy();
}

export function isDesktopBoundaryAllowed(): boolean {
  return getDesktopBoundaryPolicy().desktopAllowed;
}

export function isDesktopBoundaryBlocked(): boolean {
  return !isDesktopBoundaryAllowed();
}

export function isRoomClientAllowed(): boolean {
  return getDesktopBoundaryPolicy().roomClientAllowed;
}

// These scopes are held by the mounted room and the authenticated call host.
let roomRouteActive = false;
let friendCallAccountActive = false;

export function setRoomRouteActive(active: boolean): void {
  roomRouteActive = active;
}

export function retainMobileFriendCallRealtime(): () => void {
  friendCallAccountActive = true;
  return () => {
    friendCallAccountActive = false;
  };
}

/**
 * Phones use realtime while a room is mounted or a signed-in call session is active.
 */
export function isRealtimeBlocked(): boolean {
  return isDesktopBoundaryBlocked() && !((roomRouteActive || friendCallAccountActive) && isRoomClientAllowed());
}
