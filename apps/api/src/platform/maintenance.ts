// Background upkeep a running API does on timers: reaping half-open sockets,
// and the periodic sweeps (idle rooms, sessions, sign-in history, finished
// account deletions, expired link previews, retention). Every task is
// measured and logged on failure; none of them stops the others.

import type { Logger } from 'pino';
import { LOG_EVENTS } from '../lib/log-events.ts';

export interface MaintenanceTask {
  /** The metric label. */
  name: string;
  /** The `task` field of the failure log line. */
  label: string;
  failureMessage: string;
  run(): Promise<unknown>;
  /** Checked on every tick; a task that is off is skipped, not unscheduled. */
  enabled?: () => boolean;
}

export interface MaintenanceOptions {
  keepaliveMs: number;
  intervalMs: number;
  pruneSockets(): void;
  tasks: MaintenanceTask[];
  observe(name: string, run: () => Promise<unknown>): Promise<unknown>;
  logger: Pick<Logger, 'error'>;
}

/** Starts the timers and stops them when the server closes; returns the sweep timer, if any. */
export function startMaintenanceTimers(server: { once(event: 'close', listener: () => void): unknown }, options: MaintenanceOptions): ReturnType<typeof setInterval> | null {
  const { logger } = options;
  // Half-open sockets never emit 'close'; without this dead peers linger in
  // rosters and friends stay "online" forever.
  const socketTimer = setInterval(() => {
    try {
      options.pruneSockets();
    } catch (error) {
      logger.error({ evt: LOG_EVENTS.MAINTENANCE_TASK_FAILED, task: 'ws-prune', err: error }, 'ws prune timer failed');
    }
  }, options.keepaliveMs);
  socketTimer.unref?.();
  server.once('close', () => clearInterval(socketTimer));

  if (options.intervalMs <= 0) return null;
  const timer = setInterval(() => {
    for (const task of options.tasks) {
      if (task.enabled && !task.enabled()) continue;
      void options.observe(task.name, () => task.run()).catch((error) => {
        logger.error({ evt: LOG_EVENTS.MAINTENANCE_TASK_FAILED, task: task.label, err: error }, task.failureMessage);
      });
    }
  }, options.intervalMs);
  timer.unref?.();
  server.once('close', () => clearInterval(timer));
  return timer;
}
