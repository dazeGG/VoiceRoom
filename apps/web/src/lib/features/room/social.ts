// What the room needs from the signed-in account's social graph: friends to
// invite and show as online, the relationship behind a participant's menu, and
// the friend actions it offers. The lobby provides it; a guest's standalone
// room has no social graph, so everything answers "stranger" there.

import { getContext, setContext } from 'svelte';
import type { Friend, PublicUser, Relationship, SendRequestStatus } from '$lib/api/friends';

export interface RoomSocial {
  friends(): Friend[];
  relationship(userId: string): Relationship;
  /** The @login of someone the account already knows, '' for a stranger. */
  knownLogin(userId: string): string;
  addFriend(userId: string): Promise<{ status: SendRequestStatus; user: PublicUser }>;
  acceptRequest(userId: string): Promise<void>;
  removeFriend(userId: string): Promise<void>;
  openDm(userId: string): Promise<void>;
  /** Switches the lobby to its friends view (to show a DM that was opened). */
  showFriends(): void;
}

const unavailable = (): Promise<never> => Promise.reject(new Error('Нужен аккаунт'));

const NO_ROOM_SOCIAL: RoomSocial = {
  friends: () => [],
  relationship: () => 'none',
  knownLogin: () => '',
  addFriend: unavailable,
  acceptRequest: unavailable,
  removeFriend: unavailable,
  openDm: unavailable,
  showFriends: () => {}
};

const KEY = Symbol('room-social');

/** Called by the page that hosts rooms (the lobby) during its initialisation. */
export function provideRoomSocial(social: RoomSocial): void {
  setContext(KEY, social);
}

/** The context entry for a room mounted outside the lobby (mount/render `context`). */
export function roomSocialContext(social: RoomSocial): Map<symbol, RoomSocial> {
  return new Map([[KEY, social]]);
}

/** Read during a room component's initialisation. */
export function useRoomSocial(): RoomSocial {
  return getContext<RoomSocial | undefined>(KEY) ?? NO_ROOM_SOCIAL;
}
