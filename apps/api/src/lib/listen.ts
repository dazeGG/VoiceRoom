import fs from 'node:fs';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { LOG_EVENTS } from './log-events.ts';
import { createLogger } from './logger.ts';

type ListenLogger = { info(...args: unknown[]): void; warn(...args: unknown[]): void; fatal(...args: unknown[]): void };
type ListenableServer = {
  listen(...args: unknown[]): unknown;
  once(event: 'error', listener: (error: NodeJS.ErrnoException) => void): unknown;
  removeListener(event: 'error', listener: (error: NodeJS.ErrnoException) => void): unknown;
  address(): AddressInfo | string | null;
};

function startApiListener({
  exit = process.exit,
  host = '127.0.0.1',
  logger = createLogger({ name: 'api' }),
  port = 3000,
  server,
  socketPath = ''
}: {
  exit?: (code: number) => void;
  host?: string;
  logger?: ListenLogger;
  port?: number;
  server?: ListenableServer;
  socketPath?: string;
} = {}): void {
  if (!server || typeof server.listen !== 'function') {
    throw new TypeError('A server with a listen method is required');
  }
  const listener = server;

  function logListenAddress(mode: 'tcp' | 'unix', address: AddressInfo | string | null): void {
    if (mode === 'unix') {
      logger.info({ evt: LOG_EVENTS.LISTENING, transport: 'unix', address }, 'Voice Room API is listening');
      return;
    }

    const actual = typeof address === 'object' && address ? address : null;
    const listenHost = actual?.address || host;
    const listenPort = actual?.port || port;
    logger.info({ evt: LOG_EVENTS.LISTENING, transport: 'tcp', host: listenHost, port: listenPort }, 'Voice Room API is listening');
  }

  function failToStart(error: unknown): void {
    logger.fatal({ evt: LOG_EVENTS.BOOTSTRAP_FAILED, err: error }, 'Voice Room API failed to start');
    if (typeof process !== 'undefined') {
      process.exitCode = 1;
    }
    exit(1);
  }

  function listenOnTcp(): void {
    const handleTcpError = (error: NodeJS.ErrnoException) => {
      listener.removeListener('error', handleTcpError);
      failToStart(error);
    };

    listener.once('error', handleTcpError);
    listener.listen(port, host, () => {
      listener.removeListener('error', handleTcpError);
      logListenAddress('tcp', listener.address());
    });
  }

  function canConnectToSocket(pathname: string, callback: (canConnect: boolean) => void): void {
    let settled = false;
    const client = net.createConnection(pathname);
    const timer = setTimeout(() => finish(false), 250);

    function finish(canConnect: boolean): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.destroy();
      callback(canConnect);
    }

    client.once('connect', () => finish(true));
    client.once('error', () => finish(false));
  }

  function listenOnUnix({ retried = false }: { retried?: boolean } = {}): void {
    const handleSocketError = (error: NodeJS.ErrnoException) => {
      listener.removeListener('error', handleSocketError);

      if (error?.code === 'EADDRINUSE' && !retried) {
        canConnectToSocket(socketPath, (inUse) => {
          if (inUse) {
            failToStart(error);
            return;
          }

          try {
            fs.unlinkSync(socketPath);
          } catch (unlinkError) {
            if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') {
              failToStart(unlinkError);
              return;
            }
          }
          listenOnUnix({ retried: true });
        });
        return;
      }

      if (error && (error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'ENOTSUP')) {
        logger.warn({
          evt: LOG_EVENTS.LISTEN_FALLBACK,
          socketPath,
          host,
          port,
          err: error
        }, 'unable to bind the unix socket; falling back to a TCP listen');
        listenOnTcp();
        return;
      }

      failToStart(error);
    };

    listener.once('error', handleSocketError);
    listener.listen(socketPath, () => {
      listener.removeListener('error', handleSocketError);
      logListenAddress('unix', socketPath);
    });
  }

  if (socketPath) {
    listenOnUnix();
    return;
  }

  listenOnTcp();
}

export { startApiListener };
