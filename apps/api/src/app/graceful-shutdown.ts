// SIGTERM/SIGINT: tell every realtime socket we are going away, stop
// accepting requests, close the stores, and exit. A shutdown that hangs is
// cut off after the timeout.

import type { Logger } from 'pino';
import { LOG_EVENTS } from '../lib/log-events.ts';

export interface GracefulShutdownOptions {
  logger: Pick<Logger, 'info' | 'error'>;
  /** The open realtime sockets to close with 1001 before the server stops. */
  sockets(): Iterable<{ socket: { close(code: number, reason: string): void } }>;
  closeStores(logger: Pick<Logger, 'error'>): Promise<void>;
  exit?: (code: number) => void;
  timeoutMs?: number;
  signals?: Pick<NodeJS.Process, 'once'>;
}

export function installGracefulShutdown(server: { close(callback: () => void): unknown }, options: GracefulShutdownOptions): (signal: string) => Promise<void> {
  const { logger, exit = process.exit, timeoutMs = 8000, signals = process } = options;
  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ evt: LOG_EVENTS.SHUTDOWN_STARTED, signal }, 'shutting down gracefully');
    const timeout = setTimeout(() => {
      logger.error({ evt: LOG_EVENTS.SHUTDOWN_TIMEOUT, timeoutMs }, 'graceful shutdown timed out; exiting');
      exit(1);
    }, timeoutMs);
    timeout.unref?.();

    try {
      for (const connection of options.sockets()) {
        try {
          connection.socket.close(1001, 'Going away');
        } catch {
          // A socket that fails to close is gone anyway.
        }
      }
      await new Promise<void>((resolve) => server.close(resolve));
      await options.closeStores(logger);
      clearTimeout(timeout);
      exit(0);
    } catch (error) {
      clearTimeout(timeout);
      logger.error({ evt: LOG_EVENTS.SHUTDOWN_FAILED, err: error }, 'graceful shutdown failed');
      exit(1);
    }
  }

  signals.once('SIGTERM', () => void shutdown('SIGTERM'));
  signals.once('SIGINT', () => void shutdown('SIGINT'));
  return shutdown;
}
