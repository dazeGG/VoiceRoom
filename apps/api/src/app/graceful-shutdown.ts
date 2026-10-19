// SIGTERM/SIGINT: tell every realtime socket we are going away, stop
// accepting requests, close the stores, and exit. A shutdown that hangs is
// cut off after the timeout.
//
// A deploy waits for this process to exit, and the site is down meanwhile, so
// nothing may hold it: a peer that does not answer the close handshake (a
// frozen tab behind the proxy) or a request still in flight is cut after a
// short grace instead of running into the timeout.

import type { Logger } from 'pino';
import { LOG_EVENTS } from '../lib/log-events.ts';

export interface GracefulShutdownOptions {
  logger: Pick<Logger, 'info' | 'error'>;
  /** The open realtime sockets to close with 1001 before the server stops. */
  sockets(): Iterable<{ socket: { close(code: number, reason: string): void; terminate?(): void } }>;
  closeStores(logger: Pick<Logger, 'error'>): Promise<void>;
  exit?: (code: number) => void;
  timeoutMs?: number;
  /** How long sockets and requests get to finish before they are cut. */
  socketGraceMs?: number;
  signals?: Pick<NodeJS.Process, 'once'>;
}

type ClosableServer = { close(callback: () => void): unknown; closeAllConnections?(): void };

export function installGracefulShutdown(
  server: ClosableServer,
  options: GracefulShutdownOptions
): (signal: string) => Promise<void> {
  const {
    logger,
    exit = (code: number) => process.exit(code),
    timeoutMs = 8000,
    socketGraceMs = 1000,
    signals = process
  } = options;
  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    const started = Date.now();
    logger.info({ evt: LOG_EVENTS.SHUTDOWN_STARTED, signal }, 'shutting down gracefully');
    const timeout = setTimeout(() => {
      logger.error({ evt: LOG_EVENTS.SHUTDOWN_TIMEOUT, timeoutMs }, 'graceful shutdown timed out; exiting');
      exit(1);
    }, timeoutMs);
    timeout.unref?.();

    try {
      const sockets = [...options.sockets()];
      for (const connection of sockets) {
        try {
          connection.socket.close(1001, 'Going away');
        } catch {
          // A socket that fails to close is gone anyway.
        }
      }
      const socketsMs = Date.now() - started;

      const serverClosed = new Promise<void>((resolve) => server.close(resolve));
      const graceOver = new Promise<'grace'>((resolve) => setTimeout(() => resolve('grace'), socketGraceMs).unref?.());
      if ((await Promise.race([serverClosed, graceOver])) === 'grace') {
        // Upgraded sockets are no longer HTTP connections, so they are cut one by one.
        for (const connection of sockets) {
          try {
            connection.socket.terminate?.();
          } catch {
            // Already gone.
          }
        }
        server.closeAllConnections?.();
        await serverClosed;
      }
      const serverMs = Date.now() - started - socketsMs;

      await options.closeStores(logger);
      const storesMs = Date.now() - started - socketsMs - serverMs;
      clearTimeout(timeout);
      logger.info(
        { evt: LOG_EVENTS.SHUTDOWN_COMPLETED, socketsMs, serverMs, storesMs, sockets: sockets.length },
        'shut down'
      );
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
