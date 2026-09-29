// How the room chat lays its messages out: one section per calendar day, and
// within a day the bursts of one author (under five minutes apart) share one
// avatar, name and time. Pure, so the layout rules are tested without a DOM.

import type { PublicPeer } from '@voice-room/shared/contracts/rooms';
import type { ChatMessage } from '$lib/api/rooms';
import { formatChatDayLabel, isSameDay } from '$lib/shared/utils/chat-date';
import { getAvatarPresentation } from './client/ui/avatar-presentation';

const BURST_GAP_MS = 5 * 60 * 1000;

export interface ChatGroup {
  key: string;
  name: string;
  peerId: string;
  self: boolean;
  avatarBackground: string;
  avatarUrl: string | null;
  createdAt: number;
  messages: ChatMessage[];
}

export interface ChatDay {
  key: string;
  label: string;
  groups: ChatGroup[];
}

export function buildChatDays(items: ChatMessage[], isOwn: (message: ChatMessage) => boolean): ChatDay[] {
  const result: ChatDay[] = [];
  for (const message of items) {
    let day = result.at(-1);
    if (!day || !isSameDay(Number(day.key), message.createdAt)) {
      day = { key: String(message.createdAt), label: formatChatDayLabel(message.createdAt), groups: [] };
      result.push(day);
    }

    const author = message.name || 'Гость';
    const last = day.groups.at(-1);
    const sameAuthor = last && last.peerId === message.peerId && last.name === author;
    const close = last && message.createdAt - (last.messages.at(-1)?.createdAt ?? 0) < BURST_GAP_MS;
    if (last && sameAuthor && close) {
      last.messages.push(message);
      continue;
    }
    const self = isOwn(message);
    const avatar = getAvatarPresentation({
      avatarAccent: message.avatarAccent || undefined,
      avatarColorKey: message.avatarColorKey,
      avatarUrl: message.avatarUrl || undefined,
      isLocal: self,
      name: author
    });
    day.groups.push({
      key: message.id,
      name: author,
      peerId: message.peerId,
      self,
      avatarBackground: avatar.background,
      avatarUrl: avatar.src,
      createdAt: message.createdAt,
      messages: [message]
    });
  }
  return result;
}

/**
 * Messages show their author's current profile. When the room broadcasts a
 * changed peer, the messages it wrote (as that peer, or as the same account
 * from another peer) take the new name and avatar. Answers null when nothing
 * shown is out of date, so the caller can skip a re-render.
 */
export function restampAuthor(messages: ChatMessage[], peer: PublicPeer): ChatMessage[] | null {
  const authored = (message: ChatMessage) =>
    message.peerId === peer.id || Boolean(peer.accountUserId && message.authorUserId === peer.accountUserId);
  const stale = (message: ChatMessage) =>
    message.name !== peer.name ||
    message.avatarUrl !== peer.avatarUrl ||
    message.avatarAccent !== peer.avatarAccent ||
    (Boolean(peer.avatarColorKey) && message.avatarColorKey !== peer.avatarColorKey);
  if (!messages.some((message) => authored(message) && stale(message))) return null;
  return messages.map((message) =>
    authored(message)
      ? {
          ...message,
          name: peer.name || message.name,
          avatarAccent: peer.avatarAccent,
          avatarColorKey: peer.avatarColorKey || message.avatarColorKey,
          avatarUrl: peer.avatarUrl
        }
      : message
  );
}

/** Whether the message mentions this account, so the reader's row stands out. */
export function mentionsUser(message: ChatMessage, userId: string | undefined): boolean {
  if (!userId || message.content?.version !== 1) return false;
  return message.content.segments.some((segment) => segment.type === 'mention' && segment.userId === userId);
}

/**
 * The recent window after the server's latest messages: known ids take the
 * server's copy (edits missed while disconnected), new ones are added, and
 * messages appended locally outside the window stay.
 */
export function mergeLatestWindow(shown: ChatMessage[], latest: ChatMessage[]): ChatMessage[] {
  const known = new Set(shown.map((item) => item.id));
  const latestById = new Map(latest.map((item) => [item.id, item]));
  const incoming = latest.filter((item) => item?.id && !known.has(item.id));
  return [...shown.map((item) => latestById.get(item.id) ?? item), ...incoming].sort(
    (a, b) => a.createdAt - b.createdAt
  );
}
