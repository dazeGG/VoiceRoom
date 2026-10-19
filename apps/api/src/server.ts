// The API process entry: bootstrap() prepares the database and storage and
// starts listening. The composition itself is app/api-runtime.ts.

import { createApiRuntime, type ApiServer } from './app/api-runtime.ts';
import { installGracefulShutdown } from './app/graceful-shutdown.ts';
import { readBootstrapConfig } from './app/config.ts';
import { readDatabaseConfig } from './lib/config.ts';
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
    const { services } = runtime;
    services.connect({ databaseUrl: database.url, logger });
    const roomStore = services.getRoomStore();
    await roomStore.markActiveTemporaryRoomsEmpty();
    await roomStore.pruneRooms();
    const userStore = services.getUserStore();
    const pushSubscriptions = services.getPushSubscriptions();
    const pushService = createPushService({ store: pushSubscriptions, config: runtime.config.PUSH, logger });
    const avatarStorage = createAvatarStorage({ uploadsDir: runtime.config.UPLOADS_DIR });
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
    const linkPreviewStorage = createLinkPreviewStorage({ uploadsDir: runtime.config.UPLOADS_DIR });
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
      notifications: services.getNotificationPreferences(),
      pushes: pushSubscriptions,
      push: pushService,
      avatars: avatarStorage
    });
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
