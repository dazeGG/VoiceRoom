// The notification domain wired together: the bell inbox, mentions and who
// may be mentioned, and the notification outbox.

import type pg from 'pg';
import type { CursorCodec } from '../../platform/cursor-codec.ts';
import type { createNotificationStore } from '../../lib/notification-store.ts';
import type { createActiveBanService } from '../moderation/active-ban.service.ts';
import { createInboxRepository } from './inbox.repository.ts';
import { createMentionEligibilityService } from './mention-eligibility.service.ts';
import { createMentionRepository } from './mention.repository.ts';
import { createNotificationOutboxRepository } from './notification-outbox.repository.ts';
import { createNotificationService } from './notification.service.ts';

export interface NotificationsModuleDeps {
  pool: pg.Pool;
  cursorCodec: CursorCodec;
  activeBans: ReturnType<typeof createActiveBanService>;
  notificationStore: ReturnType<typeof createNotificationStore>;
}

export function createNotificationsModule(deps: NotificationsModuleDeps) {
  const { pool } = deps;
  const inbox = createInboxRepository({ pool });
  const mentions = createMentionRepository({ pool });
  const eligibility = createMentionEligibilityService({ activeBanService: deps.activeBans, pool });
  const outbox = createNotificationOutboxRepository({ pool });
  const service = createNotificationService({
    pool,
    inbox,
    mentions,
    eligibility,
    outbox,
    cursorCodec: deps.cursorCodec,
    notificationStore: deps.notificationStore
  });
  return { eligibility, inbox, mentions, outbox, service };
}

export type NotificationsModule = ReturnType<typeof createNotificationsModule>;
