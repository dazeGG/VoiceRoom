// Friends, friend requests, blocks and ringing a friend into a room. Every
// change that another person should see reaches them as an account event and,
// where it matters, a push.

import type { PushPayload } from '../notifications/notification-dispatch.ts';
import { notificationActor, isActiveAccount, type SocialUser } from './social-views.ts';

type Status<T extends string> = T extends string ? { status: T } : never;

interface FriendEntry {
  user: { id: string; [key: string]: unknown };
  friendsSince?: unknown;
  unreadCount?: number;
  lastMessage?: unknown;
}

export interface FriendStore {
  listFriends(userId: string): Promise<FriendEntry[]>;
  countIncomingRequests(userId: string): Promise<number>;
  searchUsers(input: { query: string; excludeUserId: string }): Promise<{ id: string; [key: string]: unknown }[]>;
  getFriendIds(userId: string): Promise<string[]>;
  listRequests(userId: string): Promise<{ incoming: { user: { id: string } }[]; outgoing: { user: { id: string } }[]; [key: string]: unknown }>;
  sendRequest(input: { requesterId: string; addresseeLogin: string; addresseeUserId: string }): Promise<{ status: string; user?: { id: string; [key: string]: unknown }; requestId?: string }>;
  respondRequest(input: { userId: string; requestId: string; action: 'accept' | 'decline' }): Promise<{ status: string; requesterId?: string; user?: unknown }>;
  cancelRequest(input: { userId: string; requestId: string }): Promise<{ status: string; addresseeId?: string }>;
  removeFriend(input: { userId: string; friendId: string }): Promise<{ status: string }>;
  listBlockedUserIds(userId: string): Promise<string[]>;
  listBlockedUsers(userId: string): Promise<unknown[]>;
  blockUser(input: { userId: string; targetId: string }): Promise<{ status: string; unfriended?: boolean }>;
  unblockUser(input: { userId: string; targetId: string }): Promise<{ status: string }>;
  areFriends(a: string, b: string): Promise<boolean>;
  isBlockedBetween(a: string, b: string): Promise<boolean>;
}

export interface FriendsDeps {
  friends(): FriendStore;
  findUser(userId: string): Promise<SocialUser | null>;
  findRoom(roomId: string): Promise<{ id: string; name?: string; emoji?: string } | null>;
  sendDirectMessage(input: { senderId: string; recipientId: string; body: string; metadata: Record<string, unknown> }): Promise<unknown>;
  isOnline(userId: string): boolean;
  notifyUser(userId: string, event: Record<string, unknown>): void;
  queuePush(userId: string, payload: PushPayload, context?: Record<string, unknown>): Promise<unknown>;
  ringLimiter: { check(key: string): { allowed: boolean; retryAfterSeconds?: number } };
  ringTtlMs: number;
  now?: () => number;
}

export function createFriendsService(deps: FriendsDeps) {
  const now = deps.now || Date.now;

  function friendPush(userId: string, type: 'friend.accepted' | 'friend.request', actor: SocialUser, dedupeKey: string): void {
    void deps.queuePush(userId, {
      type,
      title: type === 'friend.accepted' ? 'Заявка принята' : 'Новая заявка в друзья',
      body: actor.displayName || actor.login || 'VoiceRoom',
      privateBody: 'Откройте VoiceRoom, чтобы посмотреть событие.',
      tag: type,
      dedupeKey,
      url: '/'
    });
  }

  function announceAccepted(requesterId: string, accepter: SocialUser, context: Record<string, unknown>): void {
    const dedupeKey = `friend-accepted:${requesterId}:${accepter.id}`;
    deps.notifyUser(requesterId, { type: 'friend-accepted', userId: accepter.id });
    deps.notifyUser(requesterId, { type: 'notification.friend.accepted', dedupeKey, user: notificationActor(accepter), context });
    friendPush(requesterId, 'friend.accepted', accepter, dedupeKey);
  }

  async function list(userId: string) {
    const [friends, incomingRequestCount] = await Promise.all([deps.friends().listFriends(userId), deps.friends().countIncomingRequests(userId)]);
    return {
      friends: friends.map((entry) => ({
        user: entry.user,
        friendsSince: entry.friendsSince ?? null,
        online: deps.isOnline(entry.user.id),
        unreadCount: entry.unreadCount,
        lastMessage: entry.lastMessage
      })),
      incomingRequestCount
    };
  }

  async function search(userId: string, query: string) {
    const [results, friendIds, requests] = await Promise.all([
      deps.friends().searchUsers({ query, excludeUserId: userId }),
      deps.friends().getFriendIds(userId),
      deps.friends().listRequests(userId)
    ]);
    const friendSet = new Set(friendIds);
    const outgoing = new Set(requests.outgoing.map((row) => row.user.id));
    const incoming = new Set(requests.incoming.map((row) => row.user.id));
    const relationship = (id: string) => (friendSet.has(id) ? 'friend' : outgoing.has(id) ? 'outgoing' : incoming.has(id) ? 'incoming' : 'none');
    return results.map((candidate) => ({ user: candidate, online: deps.isOnline(candidate.id), relationship: relationship(candidate.id) }));
  }

  async function requests(userId: string) {
    return deps.friends().listRequests(userId);
  }

  // A request to someone who already asked you is an acceptance.
  async function sendRequest(requester: SocialUser, target: { userId: string; login: string }): Promise<
    { status: 'sent' | 'accepted' | 'already_friends' | 'already_sent'; user: unknown } | Status<'not_found' | 'self' | 'blocked'>
  > {
    const result = await deps.friends().sendRequest({ requesterId: requester.id, addresseeLogin: target.login, addresseeUserId: target.userId });
    switch (result.status) {
      case 'not_found':
      case 'self':
      case 'blocked':
        return { status: result.status };
      case 'already_friends':
      case 'already_sent':
        return { status: result.status, user: result.user };
    }
    const addressee = result.user as { id: string };
    if (result.status === 'accepted') {
      announceAccepted(addressee.id, requester, { userId: requester.id, relationship: 'friend' });
      return { status: 'accepted', user: result.user };
    }
    deps.notifyUser(addressee.id, { type: 'friend-request' });
    deps.notifyUser(addressee.id, {
      type: 'notification.friend.request',
      dedupeKey: `friend-request:${result.requestId}`,
      requester: notificationActor(requester),
      requestId: result.requestId
    });
    friendPush(addressee.id, 'friend.request', requester, `friend-request:${result.requestId}`);
    return { status: 'sent', user: result.user };
  }

  async function respond(user: SocialUser, requestId: string, action: 'accept' | 'decline'): Promise<
    { status: 'accepted'; user: unknown } | Status<'declined' | 'not_found' | 'blocked'>
  > {
    const result = await deps.friends().respondRequest({ userId: user.id, requestId, action });
    if (result.status === 'not_found') return { status: 'not_found' };
    if (result.status === 'accepted') {
      announceAccepted(result.requesterId as string, user, { userId: user.id, relationship: 'friend', requestId });
      return { status: 'accepted', user: result.user };
    }
    if (result.status === 'blocked') return { status: 'blocked' };
    return { status: 'declined' };
  }

  async function cancel(userId: string, requestId: string): Promise<Status<'cancelled' | 'not_found'>> {
    const result = await deps.friends().cancelRequest({ userId, requestId });
    if (result.status === 'not_found') return { status: 'not_found' };
    deps.notifyUser(result.addresseeId as string, { type: 'friend-request' });
    return { status: 'cancelled' };
  }

  async function remove(userId: string, friendId: string): Promise<Status<'removed' | 'not_found'>> {
    const result = await deps.friends().removeFriend({ userId, friendId });
    if (result.status === 'not_found') return { status: 'not_found' };
    deps.notifyUser(friendId, { type: 'friend-removed', userId });
    return { status: 'removed' };
  }

  async function blocked(userId: string) {
    const [ids, users] = await Promise.all([deps.friends().listBlockedUserIds(userId), deps.friends().listBlockedUsers(userId)]);
    return { blocked: ids, users };
  }

  // The blocked side is told the friendship ended, never that a block was
  // applied: their UI simply shows the person is no longer a friend.
  async function block(userId: string, targetId: string): Promise<{ status: 'applied'; result: string } | Status<'not_found' | 'invalid'>> {
    const result = await deps.friends().blockUser({ userId, targetId });
    if (result.status === 'not_found') return { status: 'not_found' };
    if (result.status === 'invalid') return { status: 'invalid' };
    if (result.unfriended) deps.notifyUser(targetId, { type: 'friend-removed', userId });
    return { status: 'applied', result: result.status };
  }

  async function unblock(userId: string, targetId: string): Promise<Status<'unblocked' | 'not_found'>> {
    const result = await deps.friends().unblockUser({ userId, targetId });
    return { status: result.status === 'not_found' ? 'not_found' : 'unblocked' };
  }

  // Presence is deliberately not required: a friend can be invited from the
  // lobby before joining the room yourself. The per-pair limit bounds how
  // often anyone can ring the same person.
  async function ring(caller: SocialUser, roomId: string, targetUserId: string): Promise<
    Status<'rung' | 'not_friends' | 'blocked' | 'account_deleted' | 'room_not_found'> | { status: 'rate_limited'; retryAfterSeconds: number }
  > {
    if (!(await deps.friends().areFriends(caller.id, targetUserId))) return { status: 'not_friends' };
    if (await deps.friends().isBlockedBetween(caller.id, targetUserId)) return { status: 'blocked' };
    if (!isActiveAccount(await deps.findUser(targetUserId))) return { status: 'account_deleted' };
    const rate = deps.ringLimiter.check(`${caller.id}:${targetUserId}`);
    if (!rate.allowed) return { status: 'rate_limited', retryAfterSeconds: rate.retryAfterSeconds ?? 0 };
    const room = await deps.findRoom(roomId);
    if (!room) return { status: 'room_not_found' };

    const expiresAt = now() + deps.ringTtlMs;
    deps.notifyUser(targetUserId, {
      type: 'ring.incoming',
      fromUser: notificationActor(caller),
      room: { id: room.id, name: room.name || '', emoji: room.emoji || '' },
      expiresAt
    });
    // The invitation is a regular DM so both sides share one timeline entry
    // with live status. It stays actionable while the room exists; the expiry
    // only bounds the audible ring and its push.
    const invite = await deps.sendDirectMessage({
      senderId: caller.id,
      recipientId: targetUserId,
      body: room.name ? `Приглашение в комнату «${room.name}»` : 'Приглашение в комнату',
      metadata: { kind: 'room-invite', roomId: room.id, roomName: room.name || '', status: 'pending', expiresAt: null }
    });
    deps.notifyUser(targetUserId, { type: 'dm-message', message: invite });
    deps.notifyUser(caller.id, { type: 'dm-message', message: invite });
    void deps.queuePush(targetUserId, {
      type: 'ring',
      title: `${caller.displayName || caller.login || 'Друг'} зовёт вас`,
      body: room.name ? `Комната «${room.name}»` : 'Присоединиться к комнате',
      privateBody: 'Вас зовут в голосовую комнату.',
      tag: `ring:${caller.id}:${roomId}`,
      dedupeKey: `ring:${caller.id}:${roomId}:${expiresAt}`,
      url: `/r/${encodeURIComponent(roomId)}`,
      expiresAt
    }, { expiresAt });
    return { status: 'rung' };
  }

  return { list, search, requests, sendRequest, respond, cancel, remove, blocked, block, unblock, ring };
}

export type FriendsService = ReturnType<typeof createFriendsService>;
