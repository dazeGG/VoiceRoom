// The app's http.Server with the plain listen(port, callback) contract the
// process entry and older tests use: listening waits for Fastify's plugins,
// so a listening server already has its routes.

import type http from 'node:http';
import type { FastifyInstance } from 'fastify';

export type ApiServer = http.Server & { app: FastifyInstance; inject: FastifyInstance['inject'] };

export function asHttpServer(app: FastifyInstance): ApiServer {
  const server: http.Server = app.server;
  const listen = server.listen.bind(server);
  // listen() takes Node's many argument shapes; they pass through untouched,
  // only the trailing callback is held back until the app is ready.
  server.listen = (...args: unknown[]) => {
    const last = args.at(-1);
    const callback = typeof last === 'function' ? last : null;
    const listenArgs = callback ? args.slice(0, -1) : args;

    app.ready((error) => {
      if (error) {
        if (callback) {
          Reflect.apply(callback, undefined, [error]);
          return;
        }
        server.emit('error', error);
        return;
      }
      Reflect.apply(listen, undefined, [...listenArgs, callback || undefined]);
    });
    return server;
  };
  return Object.assign(server, { app, inject: app.inject.bind(app) });
}
