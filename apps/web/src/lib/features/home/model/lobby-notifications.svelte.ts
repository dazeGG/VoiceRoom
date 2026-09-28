// The lobby's mention inbox: the bell's unread count and its panel.

import { fetchNotificationInbox, markAllNotificationsRead, markNotificationRead } from '$lib/api/notifications';
import { getAppRealtime } from '$lib/api/realtime';
import { playRoomChatMessageCue } from '$lib/features/room/client/media/cues';
import { getCapabilityFeature } from '$lib/platform/capability-state.svelte';
import { createNotificationInbox } from '$lib/shared/notifications/inbox.svelte';
import { notificationPreferences } from '$lib/shared/notifications/preferences.svelte';

export class LobbyNotifications {
  /** The server offers the inbox at all. */
  enabled = $state(false);
  open = $state(false);
  readonly inbox = createNotificationInbox({
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
  start = (): (() => void) => {
    void getCapabilityFeature('engagement').then((enabled) => {
      this.enabled = enabled;
      if (enabled) void this.inbox.load();
    });
    return getAppRealtime().subscribe((event) => {
      if (!this.enabled || event.type !== 'notification.room.message') return;
      const before = this.inbox.unreadCount;
      const messageId = event.payload?.message?.id;
      void this.inbox.load().then(() => {
        if (this.inbox.unreadCount > before && !notificationPreferences.doNotDisturb) {
          playRoomChatMessageCue(messageId);
        }
      });
    });
  };

  toggle = (): void => {
    this.open = !this.open;
    if (this.open) void this.inbox.load();
  };
}
