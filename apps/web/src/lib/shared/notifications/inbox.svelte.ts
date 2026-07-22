import type { NotificationEnvelope, NotificationItem } from '@voice-room/shared/notifications';
import { normalizeNotificationEnvelope } from '@voice-room/shared/notifications';

export type NotificationInboxTransport = {
  list(cursor?: string): Promise<unknown>;
  read(id: string): Promise<unknown>;
  readAll(): Promise<unknown>;
};

export function notificationRoute(item: Pick<NotificationItem, 'roomId' | 'sourceMessageId'>): string {
  return `/r/${encodeURIComponent(item.roomId)}?chat=1&around=${encodeURIComponent(item.sourceMessageId)}`;
}

export function createNotificationInbox(transport: NotificationInboxTransport) {
  let items = $state<NotificationItem[]>([]);
  let unreadCount = $state(0);
  let revision = $state(0);
  let nextCursor = $state<string | undefined>();
  let hasMore = $state(false);
  let loading = $state(false);
  let error = $state('');

  function apply(envelope: NotificationEnvelope, append: boolean): void {
    const next = append ? [...items, ...envelope.notifications] : envelope.notifications;
    items = [...new Map(next.map((item) => [item.id, item])).values()];
    unreadCount = envelope.unreadCount; revision = Math.max(revision, envelope.revision);
    nextCursor = envelope.pageInfo.nextCursor; hasMore = envelope.pageInfo.hasMore;
  }
  async function load(append = false): Promise<void> { if (loading) return; loading=true;error='';try{const payload=await transport.list(append?nextCursor:undefined);const normalized=normalizeNotificationEnvelope(payload);if(!normalized.ok)throw new Error('Некорректный ответ сервера');apply(normalized.envelope,append);}catch(value){error=value instanceof Error?value.message:'Не удалось загрузить уведомления';}finally{loading=false;} }
  async function markRead(id: string): Promise<void> { const item=items.find((candidate)=>candidate.id===id);if(!item||item.readAt)return;await transport.read(id);item.readAt=Date.now();items=[...items];unreadCount=Math.max(0,unreadCount-1); }
  async function markAllRead(): Promise<void> { await transport.readAll();const now=Date.now();items=items.map((item)=>({...item,readAt:item.readAt??now}));unreadCount=0; }
  function reconcile(nextRevision: number): void { if(nextRevision>revision) void load(false); }
  return { get error(){return error;},get firstUnread(){return items.find((item)=>!item.readAt&&!item.retractedAt)??null;},get hasMore(){return hasMore;},get items(){return items;},get loading(){return loading;},get unreadCount(){return unreadCount;},load,markAllRead,markRead,reconcile };
}
