import type { Logger } from 'pino';
import { startApiProcess } from './app/api-process.ts';
import { createPersonalRuntime } from './app/personal-runtime.ts';
import { createPersonalLogger } from './platform/personal-logger.ts';

export function bootstrapPersonal({
  env = process.env,
  logger = createPersonalLogger({ env, name: 'api-personal' }),
  exit
}: { env?: NodeJS.ProcessEnv; logger?: Logger; exit?: (code?: number) => void } = {}) {
  return startApiProcess({
    env,
    logger,
    exit,
    prepare: async (databaseUrl) => {
      const runtime = createPersonalRuntime({ env, databaseUrl, logger });
      try {
        await runtime.reconcileOnStartup();
      } catch (error) {
        await runtime.closeStores();
        throw error;
      }
      return runtime;
    }
  });
}

if (import.meta.main) void bootstrapPersonal();
