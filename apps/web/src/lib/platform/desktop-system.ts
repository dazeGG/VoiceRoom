import { createLogger, errorContext } from '$lib/shared/log';
import { setDesktopWindowVisible } from './app-visibility';

const log = createLogger('desktop:system');

// What the desktop shell knows about the computer around the page: a game in
// front of the app window (game mode), whether the window can be seen at all
// (hidden in the tray or minimized), and the computer waking from sleep or the
// lock screen. A browser, or a shell older than this contract, has no bridge
// and every call here is a no-op.

export const GAME_MODE_CLASS = 'vr-game-mode';

export type DesktopWakeReason = 'resume' | 'unlock-screen';

const WAKE_REASONS: readonly DesktopWakeReason[] = ['resume', 'unlock-screen'];

export interface DesktopSystemHandlers {
  /** The computer woke up: connections that look open may be dead. */
  onWake: (reason: DesktopWakeReason) => void;
  onGameModeChange?: (active: boolean) => void;
}

function getBridge(): Window['voiceRoomDesktopSystem'] | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.voiceRoomDesktopSystem;
}

export function normalizeGameMode(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && (value as { gameMode?: unknown }).gameMode === true);
}

/** A shell that does not report it (older than this field) counts as visible. */
export function normalizeWindowVisible(value: unknown): boolean {
  return !(value && typeof value === 'object' && (value as { windowVisible?: unknown }).windowVisible === false);
}

export function normalizeWakeReason(value: unknown): DesktopWakeReason | null {
  const reason = value && typeof value === 'object' ? (value as { reason?: unknown }).reason : undefined;
  return typeof reason === 'string' && (WAKE_REASONS as readonly string[]).includes(reason)
    ? (reason as DesktopWakeReason)
    : null;
}

export function applyGameMode(active: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement?.classList.toggle(GAME_MODE_CLASS, active);
}

export function bindDesktopSystem(handlers: DesktopSystemHandlers): () => void {
  const bridge = getBridge();
  if (!bridge) return () => {};

  let disposed = false;
  let pushed = false;
  const applyState = (payload: unknown) => {
    if (disposed) return;
    const active = normalizeGameMode(payload);
    applyGameMode(active);
    handlers.onGameModeChange?.(active);
    setDesktopWindowVisible(normalizeWindowVisible(payload));
  };

  const unsubscribers: Array<() => void> = [];
  if (typeof bridge.onState === 'function') {
    const unsubscribe = bridge.onState((payload) => {
      pushed = true;
      applyState(payload);
    });
    if (typeof unsubscribe === 'function') unsubscribers.push(unsubscribe);
  }
  if (typeof bridge.onWake === 'function') {
    const unsubscribe = bridge.onWake((payload) => {
      const reason = normalizeWakeReason(payload);
      if (reason && !disposed) handlers.onWake(reason);
    });
    if (typeof unsubscribe === 'function') unsubscribers.push(unsubscribe);
  }
  if (typeof bridge.getState === 'function') {
    void Promise.resolve()
      .then(() => bridge.getState())
      // A pushed state is newer than this answer to the initial request.
      .then((state) => {
        if (!pushed) applyState(state);
      })
      .catch((error) => log.warn('desktop system state unavailable', errorContext(error)));
  }

  return () => {
    disposed = true;
    for (const unsubscribe of unsubscribers) unsubscribe();
    applyGameMode(false);
    setDesktopWindowVisible(true);
  };
}
