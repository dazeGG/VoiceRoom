import {
  classifyPlatform as classifySharedPlatform,
  type PlatformClass,
  type PlatformPolicy,
  type PlatformSignals
} from '@voice-room/shared/platform-class';

type RuntimeWindow = Window & {
  voiceRoomRuntime?: {
    isDesktop?: boolean;
    platform?: string;
  };
};

function runtimeWindow(): RuntimeWindow | null {
  return typeof window === 'undefined' ? null : (window as RuntimeWindow);
}

function browserNavigator(): Navigator | null {
  return typeof navigator === 'undefined' ? null : navigator;
}

function collectPlatformSignals(): PlatformSignals {
  const runtime = runtimeWindow()?.voiceRoomRuntime;
  const nav = browserNavigator();
  const userAgentData =
    'userAgentData' in (nav || {})
      ? (nav as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData
      : undefined;

  return {
    desktopBridge: runtime?.isDesktop === true,
    userAgentDataMobile: typeof userAgentData?.mobile === 'boolean' ? userAgentData.mobile : undefined,
    userAgent: nav?.userAgent || '',
    platform: runtime?.platform || nav?.platform || '',
    maxTouchPoints: Number.isFinite(nav?.maxTouchPoints) ? Number(nav?.maxTouchPoints) : 0
  };
}

export function classifyPlatform(input: PlatformSignals = collectPlatformSignals()): PlatformClass {
  return classifySharedPlatform(input);
}

export type { PlatformClass, PlatformPolicy, PlatformSignals };
