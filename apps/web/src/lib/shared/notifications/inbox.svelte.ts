import type { InboxItem, InboxItemRead, InboxPage, InboxReadAll } from '@voice-room/shared/contracts/notifications';
import { notificationRoute as sharedNotificationRoute } from '@voice-room/shared/notifications';

/** The inbox routes; their answers are checked against the contract by the API client. */
export type NotificationInboxTransport = {
  list(cursor?: string): Promise<InboxPage>;
  read(id: string): Promise<InboxItemRead>;
  readAll(): Promise<InboxReadAll>;
};

/** One route for the panel and for push alike — see the shared builder for why it avoids /r/. */
export function notificationRoute(item: Pick<InboxItem, 'roomId' | 'sourceMessageId'>): string {
  return sharedNotificationRoute(item);
}

export function createNotificationInbox(transport: NotificationInboxTransport) {
  let items = $state<InboxItem[]>([]);
  let unreadCount = $state(0);
  let revision = $state(0);
  let nextCursor = $state<string | undefined>();
  let hasMore = $state(false);
  let loading = $state(false);
  let error = $state('');
  let firstUnread = $state<InboxItem | null>(null);
  let requestGeneration = 0;

  function apply(envelope: InboxPage, append: boolean): void {
    const next = append ? [...items, ...envelope.notifications] : envelope.notifications;
    items = [...new Map(next.map((item) => [item.id, item])).values()];
    unreadCount = envelope.unreadCount;
    revision = Math.max(revision, envelope.revision);
    firstUnread = envelope.firstUnread;
    nextCursor = envelope.pageInfo.nextCursor;
    hasMore = envelope.pageInfo.hasMore;
  }
  async function load(append = false): Promise<void> {
    const generation = ++requestGeneration;
    loading = true;
    error = '';
    try {
      const page = await transport.list(append ? nextCursor : undefined);
      if (generation !== requestGeneration) return;
      apply(page, append);
    } catch (value) {
      if (generation === requestGeneration)
        error = value instanceof Error ? value.message : 'Не удалось загрузить уведомления';
    } finally {
      if (generation === requestGeneration) loading = false;
    }
  }
  async function markRead(id: string): Promise<void> {
    const item = items.find((candidate) => candidate.id === id);
    if (!item || item.readAt) return;
    const result = await transport.read(id);
    const readAt = Date.now();
    items = items.map((candidate) => (candidate.id === id ? { ...candidate, readAt } : candidate));
    revision = Math.max(revision, result.revision);
    unreadCount = Math.max(0, result.unreadCount);
    if (firstUnread?.id === id) void load(false);
  }
  async function markAllRead(): Promise<void> {
    const result = await transport.readAll();
    const now = Date.now();
    items = items.map((item) => ({ ...item, readAt: item.readAt ?? now }));
    unreadCount = Math.max(0, result.unreadCount);
    revision = Math.max(revision, result.revision);
    firstUnread = null;
  }
  function reconcile(nextRevision: number): void {
    if (nextRevision > revision) void load(false);
  }
  return {
    get error() {
      return error;
    },
    get firstUnread() {
      return firstUnread;
    },
    get hasMore() {
      return hasMore;
    },
    get items() {
      return items;
    },
    get loading() {
      return loading;
    },
    get unreadCount() {
      return unreadCount;
    },
    load,
    markAllRead,
    markRead,
    reconcile
  };
}
