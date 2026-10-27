import {
  classifyPlatform as classifySharedPlatform,
  type PlatformClass,
  type PlatformPolicy,
  type PlatformSignals
} from '@voice-room/shared/platform-class';

function runtimeWindow(): Window | null {
  return typeof window === 'undefined' ? null : window;
}

function browserNavigator(): Navigator | null {
  return typeof navigator === 'undefined' ? null : navigator;
}

function collectPlatformSignals(): PlatformSignals {
  const runtime = runtimeWindow()?.voiceRoomRuntime;
  const nav = browserNavigator();
  const userAgentData = nav?.userAgentData;

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
