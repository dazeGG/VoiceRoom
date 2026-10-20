import {
  InboxItemRead,
  InboxPage,
  InboxReadAll,
  Muted,
  Preferences,
  RoomLevel,
  type NotificationLevel,
  type NotificationPreferences
} from '@voice-room/shared/contracts/notifications';
import type { PresenceStatus } from '$lib/shared/presence';
import { api } from './client';

export type { NotificationPreferences };
export type RoomNotificationLevel = NotificationLevel;

export async function fetchNotificationPreferences(): Promise<NotificationPreferences> {
  return (await api.get('/api/notifications/preferences', Preferences)).preferences;
}

export function setDmNotificationsMuted(userId: string, muted: boolean): Promise<Muted> {
  return api.put(`/api/notifications/dm/${encodeURIComponent(userId)}/mute`, Muted, { muted });
}

export function setRoomNotificationsMuted(roomId: string, muted: boolean): Promise<Muted> {
  return api.put(`/api/notifications/room/${encodeURIComponent(roomId)}/mute`, Muted, { muted });
}

export function setPrivateNotifications(privateNotifications: boolean): Promise<Preferences> {
  return api.put('/api/notifications/privacy', Preferences, { privateNotifications });
}

export function setPresenceStatus(status: PresenceStatus, automatic = false): Promise<Preferences> {
  return api.post('/api/presence/status', Preferences, { automatic, status });
}

export function fetchNotificationInbox(cursor?: string): Promise<InboxPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return api.get(`/api/notifications/inbox${query}`, InboxPage);
}

export function markNotificationRead(notificationId: string): Promise<InboxItemRead> {
  return api.post(`/api/notifications/inbox/${encodeURIComponent(notificationId)}/read`, InboxItemRead, {});
}

export function markAllNotificationsRead(): Promise<InboxReadAll> {
  return api.post('/api/notifications/inbox/read-all', InboxReadAll, {});
}

export async function fetchRoomNotificationLevel(roomId: string): Promise<RoomNotificationLevel> {
  return (await api.get(`/api/notifications/room/${encodeURIComponent(roomId)}/level`, RoomLevel)).level;
}

export async function setRoomNotificationLevel(roomId: string, level: RoomNotificationLevel): Promise<void> {
  await api.put(`/api/notifications/room/${encodeURIComponent(roomId)}/level`, RoomLevel, { level });
}
