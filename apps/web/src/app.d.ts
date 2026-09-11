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
    voiceRoomRuntime?: {
      isDesktop?: boolean;
      platform?: string;
    };
  }
}

export {};
