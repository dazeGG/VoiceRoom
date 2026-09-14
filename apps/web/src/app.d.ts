declare module '*?raw' {
  const content: string;
  export default content;
}

declare global {
  namespace App {}

  interface Window {
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
    voiceRoomDesktopLinks?: {
      onOpen: (handler: (payload: unknown) => void) => () => void;
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
    voiceRoomRuntime?: {
      isDesktop?: boolean;
      platform?: string;
    };
  }
}

export {};
