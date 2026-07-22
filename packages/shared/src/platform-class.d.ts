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
}

export const PLATFORM_CLASS_CONTRACT: PlatformPolicy['contractVersion'];
export const PLATFORM_CLASSES: Readonly<Record<PlatformClass, PlatformClass>>;
export function classifyPlatform(input?: PlatformSignals): PlatformClass;
export function platformPolicy(platformClass: PlatformClass): PlatformPolicy;
export function classifyPlatformPolicy(input?: PlatformSignals): PlatformPolicy;
