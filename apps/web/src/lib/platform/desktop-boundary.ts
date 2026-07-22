import { browser } from '$app/environment';
import { classifyPlatformPolicy, type PlatformPolicy, type PlatformSignals } from '@voice-room/shared/platform-class';

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    mobile?: boolean;
  };
};

const DOCUMENT_BOUNDARY_KEY = 'desktopBoundary';
const DOCUMENT_PLATFORM_KEY = 'platformClass';

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

  const nav = window.navigator as NavigatorWithUserAgentData;
  return {
    desktopBridge: hasDesktopBridge(),
    userAgentDataMobile: typeof nav.userAgentData?.mobile === 'boolean' ? nav.userAgentData.mobile : undefined,
    userAgent: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints
  };
}

function writeBoundaryDataset(policy: PlatformPolicy): void {
  if (!browser) return;
  const boundary = policy.desktopAllowed ? 'allowed' : 'blocked';
  document.documentElement.dataset[DOCUMENT_BOUNDARY_KEY] = boundary;
  document.documentElement.dataset[DOCUMENT_PLATFORM_KEY] = policy.platformClass;
  document.body.dataset[DOCUMENT_BOUNDARY_KEY] = boundary;
  document.body.dataset[DOCUMENT_PLATFORM_KEY] = policy.platformClass;
}

export function resolveDesktopBoundaryPolicy(): PlatformPolicy {
  cachedPolicy = classifyPlatformPolicy(readPlatformSignals());
  return cachedPolicy;
}

export function applyDesktopBoundaryToDocument(): PlatformPolicy {
  const policy = resolveDesktopBoundaryPolicy();
  writeBoundaryDataset(policy);
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
