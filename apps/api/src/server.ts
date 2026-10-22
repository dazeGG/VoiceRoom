// The API process entry: bootstrap() migrates, opens the database, runs the
// startup tasks (app/startup-tasks.ts) and starts listening. The composition
// itself is app/api-runtime.ts.

import { createApiRuntime, type ApiServer } from './app/api-runtime.ts';
import { installGracefulShutdown } from './app/graceful-shutdown.ts';
import { readBootstrapConfig } from './app/config.ts';
import { runStartupTasks } from './app/startup-tasks.ts';
import { readDatabaseConfig } from './lib/config.ts';
import { LOG_EVENTS } from './lib/log-events.ts';
import { createLogger } from './lib/logger.ts';
import { startApiListener } from './lib/listen.ts';
import { assertMigrationReady, runMigrations } from './lib/migrate.ts';

type Logger = ReturnType<typeof createLogger>;
type AppOptions = Parameters<ReturnType<typeof createApiRuntime>['createApp']>[0];

/** A Fastify app on a runtime of its own. */
function createApiApp(options: AppOptions = {}) {
  return createApiRuntime().createApp(options);
}

/** An http.Server for the app, on a runtime of its own. */
function createApiServer(options: AppOptions = {}): ApiServer {
  return createApiRuntime().createServer(options);
}

async function bootstrap({
  env = process.env,
  logger = createLogger({ env, name: 'api' }),
  exit
}: {
  env?: NodeJS.ProcessEnv;
  logger?: Logger;
  exit?: (code?: number) => void;
} = {}): Promise<ApiServer | null> {
  // Without an injected exit the process itself ends.
  const stop = exit ?? ((code?: number) => process.exit(code));
  try {
    const database = readDatabaseConfig(env);
    const startup = readBootstrapConfig(env);
    if (startup.MIGRATE_ON_START) {
      await runMigrations({ databaseUrl: database.url, logger });
    }
    if (startup.PRODUCTION) {
      await assertMigrationReady({ databaseUrl: database.url });
    }
    const runtime = createApiRuntime({ env });
    runtime.services.connect({ databaseUrl: database.url, logger });
    await runStartupTasks(runtime.services, logger);
    const server = runtime.createServer();
    await server.app.ready();
    runtime.startPruneTimer(server, logger);
    startApiListener({
      host: runtime.config.HOST,
      port: runtime.config.PORT,
      server,
      socketPath: runtime.config.SOCKET_PATH,
      logger,
      exit: stop
    });
    const closable = {
      // Closing the Fastify app, not just its http.Server, runs the onClose
      // hooks: the message delivery listener gives its pool client back, and
      // only then can the pool end.
      close: (callback: () => void) => void server.app.close().then(callback, callback),
      closeAllConnections: () => server.closeAllConnections()
    };
    installGracefulShutdown(closable, {
      logger,
      exit: stop,
      sockets: runtime.sockets,
      closeStores: runtime.closeStores
    });
    return server;
  } catch (error) {
    logger.fatal({ evt: LOG_EVENTS.BOOTSTRAP_FAILED, err: error }, 'VoiceRoom API failed to bootstrap');
    if (!exit) process.exitCode = 1;
    stop(1);
    return null;
  }
}

if (import.meta.main) {
  void bootstrap();
}

export { bootstrap, createApiApp, createApiServer };
