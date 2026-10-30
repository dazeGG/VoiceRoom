// The lobby's mention inbox: the bell's unread count and its panel.

import { ref } from 'vue';
import { fetchNotificationInbox, markAllNotificationsRead, markNotificationRead } from '@/api/notifications';
import { getAppRealtime } from '@/api/realtime';
import { playRoomChatMessageCue } from '@/features/room/client';
import { createNotificationInbox } from '@/shared/notifications/inbox';
import { useNotificationPreferencesStore } from '@/shared/notifications/preferences.store';

export function useLobbyNotifications() {
  const open = ref(false);
  const inbox = createNotificationInbox({
    list: fetchNotificationInbox,
    read: markNotificationRead,
    readAll: markAllNotificationsRead
  });

  /**
   * Loads the inbox and keeps it current; answers the teardown.
   *
   * Without the live reload the badge only ever caught up on a page reload, so
   * a mention that arrived while the lobby was open stayed invisible until then.
   * The reload is also how a ping becomes audible. The realtime event fires for
   * every message in every room you belong to, so it cannot tell you were the
   * one addressed — the inbox can, because that is exactly what it holds. A rise
   * in its unread count means someone named you, and that is worth a sound even
   * in a room whose messages you muted: muting a room is asking not to hear the
   * conversation, not asking not to be reachable.
   */
  const start = (): (() => void) => {
    void inbox.load();
    return getAppRealtime().subscribe((event) => {
      if (event.type !== 'notification.room.message') return;
      const before = inbox.unreadCount;
      const messageId = event.payload?.message?.id;
      void inbox.load().then(() => {
        if (inbox.unreadCount > before && !useNotificationPreferencesStore().notificationPreferences.doNotDisturb) {
          playRoomChatMessageCue(messageId);
        }
      });
    });
  };

  const toggle = (): void => {
    open.value = !open.value;
    if (open.value) void inbox.load();
  };

  return { open, inbox, start, toggle };
}
