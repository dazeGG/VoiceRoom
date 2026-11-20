// The API process entry: bootstrap() migrates, opens the database, runs the
// startup tasks (app/startup-tasks.ts) and starts listening. The composition
// itself is app/api-runtime.ts.

import { createApiRuntime, type ApiServer } from './app/api-runtime.ts';
import { startApiProcess } from './app/api-process.ts';
import { runStartupTasks } from './app/startup-tasks.ts';
import { createLogger } from './lib/logger.ts';

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
  return startApiProcess({
    env,
    logger,
    exit,
    prepare: async (databaseUrl) => {
      const runtime = createApiRuntime({ env });
      runtime.services.connect({ databaseUrl, logger });
      await runStartupTasks(runtime.services, logger);
      return runtime;
    }
  });
}

if (import.meta.main) {
  void bootstrap();
}

export { bootstrap, createApiApp, createApiServer };
