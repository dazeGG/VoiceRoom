declare module '*?raw' {
  const content: string;
  export default content;
}

declare global {
  namespace App {}

  interface Window {
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
