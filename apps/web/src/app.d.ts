declare module '*?raw' {
  const content: string;
  export default content;
}

declare global {
  namespace App {}

  /** Chromium's User-Agent Client Hints; other browsers have none. */
  interface NavigatorUAData {
    mobile?: boolean;
  }
  interface Navigator {
    userAgentData?: NavigatorUAData;
  }
  interface WorkerNavigator {
    userAgentData?: NavigatorUAData;
  }

  interface Window {
    voiceRoomDesktopAppIcon?: {
      getTheme: () => Promise<unknown>;
      setTheme: (theme: string) => Promise<unknown>;
    };
    voiceRoomDesktopAttention?: {
      requestAttention: (options?: { critical?: boolean }) => Promise<unknown>;
      setBadgeCount: (count: number) => Promise<unknown>;
    };
    voiceRoomDesktopAutostart?: {
      getSettings: () => Promise<unknown>;
      setSettings: (settings: { openAtLogin?: boolean; startMinimized?: boolean }) => Promise<unknown>;
    };
    voiceRoomDesktopCall?: {
      onAction: (handler: (payload: unknown) => void) => () => void;
      setState: (state: {
        active: boolean;
        roomId?: string;
        roomName?: string;
        micMuted?: boolean;
        outputMuted?: boolean;
      }) => Promise<unknown>;
    };
    voiceRoomDesktopDiagnostics?: {
      copyInfo: () => Promise<unknown>;
      getInfo: () => Promise<unknown>;
      openLogsFolder: () => Promise<unknown>;
      setContext: (context: { userId: string; roomId: string }) => Promise<unknown>;
    };
    voiceRoomDesktopIdle?: {
      getSystemIdleTime: () => Promise<number>;
    };
    /** Running totals of the app's CPU time and every core's busy and total time, in ms (desktop 1.4.9+). */
    voiceRoomDesktopLoad?: {
      read: () => Promise<unknown>;
    };
    voiceRoomDesktopLinks?: {
      onOpen: (handler: (payload: unknown) => void) => () => void;
    };
    voiceRoomDesktopNotifications?: {
      /** Answers `{ ok: false }` when the page should show the notification itself. */
      show: (payload: { title: string; body: string; tag: string; dedupeKey: string; route?: string }) => unknown;
    };
    voiceRoomDesktopOverlay?: {
      addGame: (exe?: string) => Promise<unknown>;
      getForeground: () => Promise<unknown>;
      getSettings: () => Promise<unknown>;
      preview: () => Promise<unknown>;
      removeGame: (exe: string) => Promise<unknown>;
      setSettings: (settings: Record<string, unknown>) => Promise<unknown>;
      setSnapshot: (snapshot: { participants?: unknown[] }) => Promise<unknown>;
      setSuspended: (suspended: boolean) => Promise<unknown>;
    };
    voiceRoomDesktopSystem?: {
      getState: () => Promise<unknown>;
      onState: (handler: (payload: unknown) => void) => () => void;
      onWake: (handler: (payload: unknown) => void) => () => void;
    };
    voiceRoomDesktopUpdate?: {
      getState: () => Promise<unknown>;
      onState: (handler: (payload: unknown) => void) => () => void;
      install: () => Promise<unknown>;
    };
    voiceRoomRuntime?: {
      isDesktop?: boolean;
      platform?: string;
    };
  }
}

export {};
