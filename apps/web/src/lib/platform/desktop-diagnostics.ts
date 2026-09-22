import { createLogger, errorContext } from '$lib/shared/log';

const log = createLogger('desktop:diagnostics');

export interface DesktopDiagnosticsContext {
  userId: string;
  roomId: string;
}

let lastContextKey = '';

function getBridge(): Window['voiceRoomDesktopDiagnostics'] | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.voiceRoomDesktopDiagnostics;
}

export function desktopDiagnosticsAvailable(): boolean {
  const bridge = getBridge();
  return typeof bridge?.copyInfo === 'function' && typeof bridge?.openLogsFolder === 'function';
}

export async function openDesktopLogsFolder(): Promise<boolean> {
  const bridge = getBridge();
  if (typeof bridge?.openLogsFolder !== 'function') return false;
  try {
    const result = await bridge.openLogsFolder();
    return (result as { ok?: unknown } | null)?.ok === true;
  } catch (error) {
    log.warn('desktop logs folder failed to open', errorContext(error));
    return false;
  }
}

/** Copies the shell's system summary, which already includes the web context. */
export async function copyDesktopDiagnostics(): Promise<boolean> {
  const bridge = getBridge();
  if (typeof bridge?.copyInfo !== 'function') return false;
  try {
    const result = await bridge.copyInfo();
    return (result as { ok?: unknown } | null)?.ok === true;
  } catch (error) {
    log.warn('desktop diagnostics copy failed', errorContext(error));
    return false;
  }
}

export function syncDesktopDiagnosticsContext(context: DesktopDiagnosticsContext): void {
  const bridge = getBridge();
  if (typeof bridge?.setContext !== 'function') return;
  const payload = { roomId: context.roomId || '', userId: context.userId || '' };
  const key = JSON.stringify(payload);
  if (key === lastContextKey) return;
  lastContextKey = key;
  void Promise.resolve()
    .then(() => bridge.setContext(payload))
    .catch((error) => {
      if (lastContextKey === key) lastContextKey = '';
      log.warn('desktop diagnostics context sync failed', errorContext(error));
    });
}
