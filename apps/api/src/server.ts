// The API process entry: bootstrap() prepares the database and storage and
// starts listening. The composition itself is app/api-runtime.ts.

import { createApiRuntime, type ApiServer } from './app/api-runtime.ts';
import { installGracefulShutdown } from './app/graceful-shutdown.ts';
import { resolveRealtimeReconnectLeaseMs } from './app/config.ts';
import { readEnvBool, readDatabaseConfig, readUploadsDir } from './lib/config.ts';
import { LOG_EVENTS } from './lib/log-events.ts';
import { createLogger } from './lib/logger.ts';
import { reconcileAvatarStorage } from './lib/avatar-reconciliation.ts';
import { createAvatarStorage } from './lib/avatar-storage.ts';
import { createLinkPreviewStorage, reconcileLinkPreviewImages } from './lib/link-preview-storage.ts';
import { createLinkPreviewRepository } from './domains/link-previews/link-preview.repository.ts';
import { createPushService } from './lib/push-service.ts';
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
  exit = process.exit
}: {
  env?: NodeJS.ProcessEnv;
  logger?: Logger;
  exit?: (code?: number) => void;
} = {}): Promise<ApiServer | null> {
  try {
    const database = readDatabaseConfig(env);
    if (readEnvBool('MIGRATE_ON_START', env.NODE_ENV !== 'production', env)) {
      await runMigrations({ databaseUrl: database.url, logger });
    }
    if (env.NODE_ENV === 'production') {
      await assertMigrationReady({ databaseUrl: database.url });
    }
    const runtime = createApiRuntime({ env });
    const { services } = runtime;
    services.connect({ databaseUrl: database.url, logger });
    const roomStore = services.getRoomStore();
    await roomStore.markActiveTemporaryRoomsEmpty();
    await roomStore.pruneRooms();
    const userStore = services.getUserStore();
    const pushStore = services.getPushStore();
    const pushService = createPushService({ store: pushStore, env, logger });
    const avatarStorage = createAvatarStorage({ uploadsDir: readUploadsDir(env) });
    const reconciliation = await reconcileAvatarStorage({
      storage: avatarStorage,
      userStore,
      roomStore
    });
    if (reconciliation.removed > 0) {
      logger.info(
        { evt: LOG_EVENTS.MAINTENANCE_TASK_COMPLETED, task: 'avatar-reconciliation', removed: reconciliation.removed },
        'removed orphaned avatar files'
      );
    }
    const linkPreviewStorage = createLinkPreviewStorage({ uploadsDir: readUploadsDir(env) });
    services.install({
      pushService,
      avatarStorage,
      linkPreviewStorage
    });
    try {
      const previewPool = services.getPool();
      if (previewPool) {
        const removedPreviewImages = await reconcileLinkPreviewImages({
          storage: linkPreviewStorage,
          repository: createLinkPreviewRepository({ pool: previewPool })
        });
        if (removedPreviewImages > 0)
          logger.info(
            {
              evt: LOG_EVENTS.MAINTENANCE_TASK_COMPLETED,
              task: 'link-preview-reconciliation',
              removed: removedPreviewImages
            },
            'removed unused link preview images'
          );
      }
    } catch (error) {
      logger.warn(
        { evt: LOG_EVENTS.LINK_PREVIEW_RECONCILE_FAILED, err: error },
        'link preview image reconciliation failed'
      );
    }
    const server = runtime.createServer({
      store: roomStore,
      users: userStore,
      friends: services.getFriendStore(),
      notifications: services.getNotificationStore(),
      pushes: pushStore,
      push: pushService,
      avatars: avatarStorage,
      realtimeReconnectLeaseMs: resolveRealtimeReconnectLeaseMs(env)
    });
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
    installGracefulShutdown(server, {
      logger,
      exit,
      sockets: runtime.sockets,
      closeStores: runtime.closeStores
    });
    return server;
  } catch (error) {
    logger.fatal({ evt: LOG_EVENTS.BOOTSTRAP_FAILED, err: error }, 'Voice Room API failed to bootstrap');
    if (exit === process.exit && typeof process !== 'undefined') {
      process.exitCode = 1;
    }
    exit(1);
    return null;
  }
}

if (import.meta.main) {
  void bootstrap();
}

export { bootstrap, createApiApp, createApiServer };
