import { ref } from 'vue';
import type { InboxItem, InboxItemRead, InboxPage, InboxReadAll } from '@voice-room/shared/contracts/notifications';
import { uniqueBy } from '@/shared/utils/collections';

/** The inbox routes; their answers are checked against the contract by the API client. */
export type NotificationInboxTransport = {
  list(cursor?: string): Promise<InboxPage>;
  read(id: string): Promise<InboxItemRead>;
  readAll(): Promise<InboxReadAll>;
};

export function createNotificationInbox(transport: NotificationInboxTransport) {
  const items = ref<InboxItem[]>([]);
  const unreadCount = ref(0);
  const revision = ref(0);
  const nextCursor = ref<string | undefined>();
  const hasMore = ref(false);
  const loading = ref(false);
  const error = ref('');
  const firstUnread = ref<InboxItem | null>(null);
  let requestGeneration = 0;

  function apply(envelope: InboxPage, append: boolean): void {
    const next = append ? [...items.value, ...envelope.notifications] : envelope.notifications;
    items.value = uniqueBy(next, (item) => item.id);
    unreadCount.value = envelope.unreadCount;
    revision.value = Math.max(revision.value, envelope.revision);
    firstUnread.value = envelope.firstUnread;
    nextCursor.value = envelope.pageInfo.nextCursor;
    hasMore.value = envelope.pageInfo.hasMore;
  }
  async function load(append = false): Promise<void> {
    const generation = ++requestGeneration;
    loading.value = true;
    error.value = '';
    try {
      const page = await transport.list(append ? nextCursor.value : undefined);
      if (generation !== requestGeneration) return;
      apply(page, append);
    } catch (value) {
      if (generation === requestGeneration)
        error.value = value instanceof Error ? value.message : 'Не удалось загрузить уведомления';
    } finally {
      if (generation === requestGeneration) loading.value = false;
    }
  }
  async function markRead(id: string): Promise<void> {
    const item = items.value.find((candidate) => candidate.id === id);
    if (!item || item.readAt) return;
    const result = await transport.read(id);
    const readAt = Date.now();
    items.value = items.value.map((candidate) => (candidate.id === id ? { ...candidate, readAt } : candidate));
    revision.value = Math.max(revision.value, result.revision);
    unreadCount.value = Math.max(0, result.unreadCount);
    if (firstUnread.value?.id === id) void load(false);
  }
  async function markAllRead(): Promise<void> {
    const result = await transport.readAll();
    const now = Date.now();
    items.value = items.value.map((item) => ({ ...item, readAt: item.readAt ?? now }));
    unreadCount.value = Math.max(0, result.unreadCount);
    revision.value = Math.max(revision.value, result.revision);
    firstUnread.value = null;
  }
  function reconcile(nextRevision: number): void {
    if (nextRevision > revision.value) void load(false);
  }
  return {
    get error() {
      return error.value;
    },
    get firstUnread() {
      return firstUnread.value;
    },
    get hasMore() {
      return hasMore.value;
    },
    get items() {
      return items.value;
    },
    get loading() {
      return loading.value;
    },
    get unreadCount() {
      return unreadCount.value;
    },
    load,
    markAllRead,
    markRead,
    reconcile
  };
}
