import type { DesktopCapabilities } from '@voiceroom/call/engine/desktop-capabilities';
import { readDesktopRuntime } from '@/platform/desktop-system';

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
    return readDesktopRuntime();
  },
  get window() {
    return window.voiceRoomWindow;
  },
  get load() {
    return window.voiceRoomDesktopLoad;
  }
};
