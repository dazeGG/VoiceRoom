import type { Logger } from 'pino';
import { readDatabaseConfig } from '../lib/config.ts';
import { LOG_EVENTS } from '../lib/log-events.ts';
import { startApiListener } from '../lib/listen.ts';
import { assertMigrationReady, runMigrations } from '../lib/migrate.ts';
import type { ApiServer } from '../platform/http/http-server.ts';
import { readBootstrapConfig } from './config.ts';
import { installGracefulShutdown, type GracefulShutdownOptions } from './graceful-shutdown.ts';

interface ApiProcess {
  config: { HOST: string; PORT: number; SOCKET_PATH: string };
  createServer(): ApiServer;
  startPruneTimer(server: ApiServer, logger: Logger): unknown;
  sockets: GracefulShutdownOptions['sockets'];
  closeStores: GracefulShutdownOptions['closeStores'];
}

export async function startApiProcess({
  env,
  logger,
  exit = (code) => process.exit(code),
  prepare
}: {
  env: NodeJS.ProcessEnv;
  logger: Logger;
  exit?: ((code?: number) => void) | undefined;
  prepare: (databaseUrl: string) => Promise<ApiProcess>;
}): Promise<ApiServer | null> {
  try {
    const database = readDatabaseConfig(env);
    const startup = readBootstrapConfig(env);
    if (startup.MIGRATE_ON_START) await runMigrations({ databaseUrl: database.url, logger });
    if (startup.PRODUCTION) await assertMigrationReady({ databaseUrl: database.url });

    const runtime = await prepare(database.url);
    const server = runtime.createServer();
    await server.app.ready();
    runtime.startPruneTimer(server, logger);
    startApiListener({
      host: runtime.config.HOST,
      port: runtime.config.PORT,
      server,
      socketPath: runtime.config.SOCKET_PATH,
      logger,
      exit
    });
    installGracefulShutdown(
      {
        // Closing Fastify runs the app's onClose hooks before the pool ends.
        close: (callback) => void server.app.close().then(callback, callback),
        closeAllConnections: () => server.closeAllConnections()
      },
      { logger, exit, sockets: runtime.sockets, closeStores: runtime.closeStores }
    );
    return server;
  } catch (error) {
    logger.fatal({ evt: LOG_EVENTS.BOOTSTRAP_FAILED, err: error }, 'VoiceRoom API failed to bootstrap');
    exit(1);
    return null;
  }
}
