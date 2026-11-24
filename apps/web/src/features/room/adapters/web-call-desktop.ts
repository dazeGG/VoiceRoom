import type { DesktopCapabilities } from '@voiceroom/call/engine/desktop-capabilities';
import { readDesktopRuntime } from '@/platform/desktop-system';
import { readDesktopNativeVoiceConnectionPreference } from '@/platform/desktop-native-voice';

declare global {
  interface Window {
    voiceRoomDesktopCapture?: NonNullable<DesktopCapabilities['capture']>;
    __voiceRoomNativeCaptureStats?: NonNullable<DesktopCapabilities['captureStats']>;
    voiceRoomDesktopAudio?: NonNullable<DesktopCapabilities['audio']>;
    voiceRoomDesktopNativeVoice?: NonNullable<DesktopCapabilities['nativeVoice']>;
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
  get nativeVoice() {
    return window.voiceRoomDesktopNativeVoice;
  },
  get nativeVoicePreference() {
    return readDesktopNativeVoiceConnectionPreference();
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
