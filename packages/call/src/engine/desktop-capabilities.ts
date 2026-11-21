import type { HotkeyBinding } from '@voiceroom/ui-kit/hotkey';
import type { DesktopCaptureSource, DesktopPickerSelection } from './core/types';

// Events from the desktop app's stream-audio helper. Desktop 1.4.4+ restarts a
// crashed helper under the same session ('restarting') and sends 'exit' only when
// it gives up.
interface DesktopAudioFormatEvent {
  event: 'format' | 'error' | 'warning' | 'started' | 'stopped' | 'log' | 'restarting' | 'exit';
  message?: string;
  channels?: number;
  sampleRate?: number;
  attempt?: number;
  delayMs?: number;
  code?: number | null;
  signal?: string | null;
}

export interface DesktopCapabilities {
  capture?:
    | {
        applyProfile?: (options: { fpsId?: string; qualityId?: string }) => Promise<{
          fpsId?: string;
          maxHeight?: number;
          maxWidth?: number;
          ok: boolean;
          qualityId?: string;
          reason?: string;
        }>;
        openPicker?: (options: {
          fpsId?: string;
          qualityId?: string;
          streamAudioEnabled?: boolean;
        }) => Promise<DesktopPickerSelection | null>;
        getSources?: () => Promise<DesktopCaptureSource[]>;
        selectSource?: (
          sourceId: string,
          options: { allowEchoFallback?: boolean; enabled?: boolean; mode?: string },
          captureOptions?: { fpsId?: string; qualityId?: string }
        ) => Promise<void>;
      }
    | undefined;
  captureStats?:
    | (() => {
        framesDroppedBackpressure?: number;
        framesDroppedCreate?: number;
        framesReceived?: number;
        framesWritten?: number;
        pixelFormat?: 'NV12' | 'BGRX';
        relay?: {
          framesDroppedBackpressure?: number;
          framesInFlight?: number;
          framesParsed?: number;
          framesPosted?: number;
          helperPausedMs?: number;
          pipeline?: {
            seq: number;
            backend: 'wgc' | 'dxgi';
            acquired: number;
            acquireAttempts?: number;
            acquireEmpty?: number;
            callbackArrivals?: number;
            maxLockWaitUs?: number;
            pacingSkips: number;
            pausedSkips: number;
            written: number;
            accumulated?: number;
            sumMapUs: number;
            sumWriteUs: number;
            maxGapUs: number;
            maxMapUs: number;
            maxWriteUs: number;
          };
          restarts?: number;
        } | null;
        sessionId?: string;
      })
    | undefined;
  audio?:
    | {
        startSafeSystem: (options: { mode: string }) => Promise<{ sessionId: string }>;
        stop: (sessionId: string) => Promise<void>;
        onData: (callback: (payload: { sessionId: string; chunk: Uint8Array | ArrayBuffer }) => void) => () => void;
        onEvent: (callback: (payload: { sessionId: string; event: DesktopAudioFormatEvent }) => void) => () => void;
      }
    | undefined;
  hotkeys?:
    | {
        configure: (payload: {
          active: boolean;
          configurationId: number;
          bindings: Partial<Record<'mic-mute' | 'output-mute' | 'push-to-talk', HotkeyBinding | null>>;
        }) => Promise<{
          active: boolean;
          backend: 'native' | 'electron-fallback' | 'none';
          configurationId?: number;
          failed: Array<{ action: 'mic-mute' | 'output-mute' | 'push-to-talk'; reason: string }>;
          registered: Array<'mic-mute' | 'output-mute' | 'push-to-talk'>;
          unsupported: Array<'mic-mute' | 'output-mute' | 'push-to-talk'>;
        }>;
        onAction: (
          callback: (payload: {
            action: 'mic-mute' | 'output-mute' | 'push-to-talk';
            configurationId?: number;
            phase: 'pressed' | 'released';
          }) => void
        ) => () => void;
        onStatus: (
          callback: (result: {
            active: boolean;
            backend: 'native' | 'electron-fallback' | 'none';
            configurationId?: number;
            failed: Array<{ action: 'mic-mute' | 'output-mute' | 'push-to-talk'; reason: string }>;
            registered: Array<'mic-mute' | 'output-mute' | 'push-to-talk'>;
            unsupported: Array<'mic-mute' | 'output-mute' | 'push-to-talk'>;
          }) => void
        ) => () => void;
        setSuspended: (suspended: boolean) => Promise<boolean>;
      }
    | undefined;
  runtime?:
    | {
        isDesktop?: boolean;
        platform?: string;
        version?: string;
      }
    | undefined;
  window?:
    | {
        setFullscreen: (fullscreen: boolean) => Promise<boolean>;
      }
    | undefined;
  load?: { read(): Promise<unknown> } | undefined;
}
