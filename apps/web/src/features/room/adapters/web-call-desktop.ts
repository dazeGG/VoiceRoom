import type { DesktopCapabilities } from '@voice-room/call/engine/desktop-capabilities';

declare global {
  interface Window {
    voiceRoomDesktopCapture?: NonNullable<DesktopCapabilities['capture']>;
    __voiceRoomNativeCaptureStats?: NonNullable<DesktopCapabilities['captureStats']>;
    voiceRoomDesktopAudio?: NonNullable<DesktopCapabilities['audio']>;
    voiceRoomDesktopHotkeys?: NonNullable<DesktopCapabilities['hotkeys']>;
    voiceRoomWindow?: NonNullable<DesktopCapabilities['window']>;
  }
}

export const webCallDesktop: DesktopCapabilities = {
  get capture() {
    return window.voiceRoomDesktopCapture;
  },
  get captureStats() {
    return window.__voiceRoomNativeCaptureStats;
  },
  get audio() {
    return window.voiceRoomDesktopAudio;
  },
  get hotkeys() {
    return window.voiceRoomDesktopHotkeys;
  },
  get runtime() {
    return window.voiceRoomRuntime;
  },
  get window() {
    return window.voiceRoomWindow;
  },
  get load() {
    return window.voiceRoomDesktopLoad;
  }
};
