import { createLogger, errorContext } from '$lib/shared/log';

const log = createLogger('desktop:update');

// The desktop shell updates itself from its own releases, apart from the web
// app it shows. It reports here when a new shell is downloading or ready, and
// installs it on request (a restart that reopens the window), so the page can
// show one update notice for both. A browser, or a shell older than this
// contract, has no bridge: every call here is a no-op.

export type DesktopUpdateStatus = 'none' | 'downloading' | 'ready';

export interface DesktopUpdateState {
  status: DesktopUpdateStatus;
  version: string;
}

const STATUSES: readonly DesktopUpdateStatus[] = ['none', 'downloading', 'ready'];

function getBridge(): Window['voiceRoomDesktopUpdate'] | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.voiceRoomDesktopUpdate;
}

export function normalizeDesktopUpdate(value: unknown): DesktopUpdateState {
  const record = value && typeof value === 'object' ? (value as { status?: unknown; version?: unknown }) : {};
  const status =
    typeof record.status === 'string' && (STATUSES as readonly string[]).includes(record.status)
      ? (record.status as DesktopUpdateStatus)
      : 'none';
  return { status, version: typeof record.version === 'string' ? record.version : '' };
}

/** Follows the shell's update; answers the unsubscribe. */
export function bindDesktopUpdate(onState: (state: DesktopUpdateState) => void): () => void {
  const bridge = getBridge();
  if (!bridge) return () => {};
  let disposed = false;
  const apply = (payload: unknown) => {
    if (!disposed) onState(normalizeDesktopUpdate(payload));
  };
  const unsubscribe = bridge.onState(apply);
  void Promise.resolve()
    .then(() => bridge.getState())
    .then(apply)
    .catch((error) => log.warn('desktop update state failed', errorContext(error)));
  return () => {
    disposed = true;
    unsubscribe();
  };
}

/** Restarts the shell into the downloaded version. */
export async function installDesktopUpdate(): Promise<boolean> {
  const bridge = getBridge();
  if (!bridge) return false;
  try {
    await bridge.install();
    return true;
  } catch (error) {
    log.warn('desktop update install failed', errorContext(error));
    return false;
  }
}
