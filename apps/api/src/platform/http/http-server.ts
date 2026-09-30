// The app's http.Server with the plain listen(port, callback) contract the
// process entry and older tests use: listening waits for Fastify's plugins,
// so a listening server already has its routes.

import type http from 'node:http';
import type { FastifyInstance } from 'fastify';

export type ApiServer = http.Server & { app: FastifyInstance; inject: FastifyInstance['inject'] };

export function asHttpServer(app: FastifyInstance): ApiServer {
  const server = app.server as ApiServer;
  const listen = server.listen.bind(server);
  server.app = app;
  server.inject = app.inject.bind(app);
  const listenAfterReady = (...args: unknown[]) => {
    const last = args.at(-1);
    const callback = typeof last === 'function' ? (last as (error?: Error) => void) : null;
    const listenArgs = callback ? args.slice(0, -1) : args;

    app.ready((error) => {
      if (error) {
        if (callback) {
          callback(error);
          return;
        }
        server.emit('error', error);
        return;
      }
      (listen as (...listenArgs: unknown[]) => void)(...listenArgs, callback || undefined);
    });
    return server;
  };
  server.listen = listenAfterReady as ApiServer['listen'];
  return server;
}
