// The desktop app's bridge, as apps/web/src/app.d.ts declares it; the site reads only this flag.
interface Window {
  voiceRoomRuntime?: { isDesktop?: boolean };
}

/** Chromium's User-Agent Client Hints; other browsers have none. The download page asks for the processor. */
interface NavigatorUAData {
  getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }>;
}
interface Navigator {
  userAgentData?: NavigatorUAData;
}
