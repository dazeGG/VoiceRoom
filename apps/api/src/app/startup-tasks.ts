// What the API does once on its database before it serves: temporary rooms
// the last process left active are marked empty and stale rooms pruned, and
// avatar and link preview files no row refers to any more are removed.

import type { Logger } from 'pino';
import { LOG_EVENTS } from '../lib/log-events.ts';
import { reconcileAvatarStorage } from '../lib/avatar-reconciliation.ts';
import { reconcileLinkPreviewImages } from '../lib/link-preview-storage.ts';
import type { createServiceRegistry } from './service-registry.ts';

export async function runStartupTasks(
  services: ReturnType<typeof createServiceRegistry>,
  logger: Pick<Logger, 'info' | 'warn'>
): Promise<void> {
  const roomStore = services.getRoomStore();
  await roomStore.markActiveTemporaryRoomsEmpty();
  await roomStore.pruneRooms();
  const reconciliation = await reconcileAvatarStorage({
    storage: services.getAvatarStorage(),
    userStore: services.getUserStore(),
    roomStore
  });
  if (reconciliation.removed > 0) {
    logger.info(
      { evt: LOG_EVENTS.MAINTENANCE_TASK_COMPLETED, task: 'avatar-reconciliation', removed: reconciliation.removed },
      'removed orphaned avatar files'
    );
  }
  try {
    const repository = services.getLinkPreviewRepository();
    if (repository) {
      const removedPreviewImages = await reconcileLinkPreviewImages({
        storage: services.getLinkPreviewStorage(),
        repository
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
}
