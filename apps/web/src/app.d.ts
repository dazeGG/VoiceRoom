declare module '*?raw' {
  const content: string;
  export default content;
}

declare global {
  namespace App {}

  interface Window {
    voiceRoomDesktopAutostart?: {
      getSettings: () => Promise<unknown>;
      setSettings: (settings: { openAtLogin?: boolean; startMinimized?: boolean }) => Promise<unknown>;
    };
    voiceRoomDesktopIdle?: {
      getSystemIdleTime: () => Promise<number>;
    };
    voiceRoomRuntime?: {
      isDesktop?: boolean;
      platform?: string;
    };
  }
}

export {};
