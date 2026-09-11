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
  return typeof bridge?.openLogsFolder === 'function' && typeof bridge?.getInfo === 'function';
}

export async function openDesktopLogsFolder(): Promise<boolean> {
  const bridge = getBridge();
  if (typeof bridge?.openLogsFolder !== 'function') return false;
  try {
    const result = await bridge.openLogsFolder();
    return (result as { ok?: unknown } | null)?.ok === true;
  } catch (error) {
    console.warn('Desktop logs folder failed to open', error);
    return false;
  }
}

/** Copies the shell's system summary, which already includes the web context. */
export async function copyDesktopDiagnostics(): Promise<boolean> {
  const bridge = getBridge();
  if (!bridge) return false;
  try {
    if (typeof bridge.copyInfo === 'function') {
      const result = await bridge.copyInfo();
      return (result as { ok?: unknown } | null)?.ok === true;
    }
    if (typeof bridge.getInfo !== 'function' || !navigator.clipboard?.writeText) return false;
    const info = await bridge.getInfo();
    const text = (info as { text?: unknown } | null)?.text;
    if (typeof text !== 'string' || !text) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.warn('Desktop diagnostics copy failed', error);
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
      console.warn('Desktop diagnostics context sync failed', error);
    });
}
