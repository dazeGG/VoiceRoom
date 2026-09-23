// Which kind of device the client runs on, and what that allows: the desktop
// app features stay off on mobile, the room page works everywhere.

export type PlatformClass = 'desktop' | 'mobile' | 'unknown';

export interface PlatformSignals {
  desktopBridge?: boolean;
  userAgentDataMobile?: boolean;
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
}

export interface PlatformPolicy {
  contractVersion: 'voice-room.platform-class/v1';
  platformClass: PlatformClass;
  desktopAllowed: boolean;
  /** The room page (voice, room chat, watching a screen) may run on this platform. */
  roomClientAllowed: boolean;
}

export const PLATFORM_CLASS_CONTRACT: PlatformPolicy['contractVersion'] = 'voice-room.platform-class/v1';
export const PLATFORM_CLASSES: Readonly<Record<PlatformClass, PlatformClass>> = Object.freeze({
  desktop: 'desktop',
  mobile: 'mobile',
  unknown: 'unknown'
});

function normalizedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function classifyPlatform(input: PlatformSignals = {}): PlatformClass {
  if (input.desktopBridge === true) return PLATFORM_CLASSES.desktop;

  if (typeof input.userAgentDataMobile === 'boolean') {
    return input.userAgentDataMobile ? PLATFORM_CLASSES.mobile : PLATFORM_CLASSES.desktop;
  }

  const userAgent = normalizedString(input.userAgent);
  const platform = normalizedString(input.platform);
  const maxTouchPoints = Number.isFinite(input.maxTouchPoints) ? Number(input.maxTouchPoints) : 0;

  if (/android|iphone|ipod|windows phone|mobile/i.test(userAgent)) return PLATFORM_CLASSES.mobile;
  if (/ipad/i.test(userAgent)) return PLATFORM_CLASSES.mobile;
  if (/^MacIntel$/i.test(platform) && maxTouchPoints > 1) return PLATFORM_CLASSES.mobile;

  if (/windows|macintosh|cros|x11|linux/i.test(userAgent)) return PLATFORM_CLASSES.desktop;
  if (/^win|^mac|^linux/i.test(platform)) return PLATFORM_CLASSES.desktop;
  return PLATFORM_CLASSES.unknown;
}

export function platformPolicy(platformClass: unknown): PlatformPolicy {
  const normalized: PlatformClass = (Object.values(PLATFORM_CLASSES) as unknown[]).includes(platformClass)
    ? platformClass as PlatformClass
    : PLATFORM_CLASSES.unknown;
  return {
    contractVersion: PLATFORM_CLASS_CONTRACT,
    platformClass: normalized,
    desktopAllowed: normalized !== PLATFORM_CLASSES.mobile,
    // A room page works in a mobile browser too (voice, chat, watching a
    // screen); everything else stays desktop-only behind desktopAllowed.
    roomClientAllowed: true
  };
}

export function classifyPlatformPolicy(input: PlatformSignals = {}): PlatformPolicy {
  return platformPolicy(classifyPlatform(input));
}
