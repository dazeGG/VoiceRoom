// Small presentational helpers shared by the lobby views.

import type { PublicUser } from '$lib/api/friends';
import { formatChatDayLabel, isSameDay } from '$lib/shared/utils/chat-date';
import { getAvatarColor } from '$lib/visual/tokens';

export function friendName(user: Pick<PublicUser, 'displayName' | 'login'>): string {
  return user.displayName?.trim() || user.login;
}

export function initial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
}

export function avatarBackground(colorKey: string | null | undefined): string {
  return getAvatarColor(colorKey).background;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function formatTime(ms: number): string {
  const date = new Date(ms);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export { isSameDay };

export function formatDayLabel(ms: number): string {
  return formatChatDayLabel(ms);
}
