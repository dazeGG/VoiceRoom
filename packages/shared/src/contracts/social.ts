// Friends, friend requests, blocks and ringing a friend into a room.

import { Type, type Static } from 'typebox';
import { Done, Nullable, Ok } from './http.ts';
import { PublicUser } from './users.ts';

export const FriendLastMessage = Type.Object({
  id: Type.String(),
  body: Type.String(),
  createdAt: Nullable(Type.Number()),
  fromMe: Type.Boolean()
});
export type FriendLastMessage = Static<typeof FriendLastMessage>;

export const Friend = Type.Object({
  user: PublicUser,
  /** When the friendship started; null for pairs that predate the column. */
  friendsSince: Nullable(Type.Number()),
  online: Type.Boolean(),
  unreadCount: Type.Number(),
  lastMessage: Nullable(FriendLastMessage)
});
export type Friend = Static<typeof Friend>;

export const FriendList = Ok({ friends: Type.Array(Friend), incomingRequestCount: Type.Number() });
export type FriendList = Static<typeof FriendList>;

export const Relationship = Type.Union([
  Type.Literal('friend'),
  Type.Literal('outgoing'),
  Type.Literal('incoming'),
  Type.Literal('none')
]);
export type Relationship = Static<typeof Relationship>;

export const SearchResult = Type.Object({ user: PublicUser, online: Type.Boolean(), relationship: Relationship });
export type SearchResult = Static<typeof SearchResult>;

export const FriendSearchQuery = Type.Object({ q: Type.Optional(Type.String()) });
export const FriendSearch = Ok({ results: Type.Array(SearchResult) });
export type FriendSearch = Static<typeof FriendSearch>;

export const IncomingRequest = Type.Object({
  id: Type.String(),
  createdAt: Nullable(Type.Number()),
  mutualFriends: Type.Number(),
  user: PublicUser
});
export type IncomingRequest = Static<typeof IncomingRequest>;

export const OutgoingRequest = Type.Object({ id: Type.String(), createdAt: Nullable(Type.Number()), user: PublicUser });
export type OutgoingRequest = Static<typeof OutgoingRequest>;

export const FriendRequests = Ok({ incoming: Type.Array(IncomingRequest), outgoing: Type.Array(OutgoingRequest) });
export type FriendRequests = Static<typeof FriendRequests>;

/** Either field names the person: a login from search, a user id from a room. */
export const SendFriendRequestBody = Type.Object({
  userId: Type.Optional(Type.String()),
  addresseeUserId: Type.Optional(Type.String()),
  login: Type.Optional(Type.String()),
  handle: Type.Optional(Type.String())
});
export type SendFriendRequestBody = Static<typeof SendFriendRequestBody>;

export const SendRequestStatus = Type.Union([
  Type.Literal('sent'),
  Type.Literal('accepted'),
  Type.Literal('already_sent'),
  Type.Literal('already_friends')
]);
export type SendRequestStatus = Static<typeof SendRequestStatus>;

export const FriendRequestSent = Ok({ status: SendRequestStatus, user: PublicUser });
export type FriendRequestSent = Static<typeof FriendRequestSent>;

export const FriendRequestAnswered = Type.Union([
  Ok({ status: Type.Literal('accepted'), user: PublicUser }),
  Ok({ status: Type.Literal('declined') })
]);
export type FriendRequestAnswered = Static<typeof FriendRequestAnswered>;

export const BlockList = Ok({ blocked: Type.Array(Type.String()), users: Type.Array(PublicUser) });
export type BlockList = Static<typeof BlockList>;

export const BlockApplied = Ok({ status: Type.Union([Type.Literal('blocked'), Type.Literal('already_blocked')]) });
export type BlockApplied = Static<typeof BlockApplied>;

export const RingBody = Type.Object({ userId: Type.Optional(Type.String()) });

export { Done };
