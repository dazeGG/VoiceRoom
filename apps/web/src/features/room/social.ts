// What the room needs from the signed-in account's social graph: friends to
// invite and show as online, the relationship behind a participant's menu, and
// the friend actions it offers. The lobby provides it; a guest's standalone
// room has no social graph, so everything answers "stranger" there.

import { inject, provide, type InjectionKey } from 'vue';
import type { Friend, PublicUser, Relationship, SendRequestStatus } from '@/api/friends';

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

export const ROOM_SOCIAL_KEY: InjectionKey<RoomSocial> = Symbol('room-social');

/** Called by the page that hosts rooms (the lobby) during its setup. */
export function provideRoomSocial(social: RoomSocial): void {
  provide(ROOM_SOCIAL_KEY, social);
}

/** Read during a room component's setup. */
export function useRoomSocial(): RoomSocial {
  return inject(ROOM_SOCIAL_KEY, NO_ROOM_SOCIAL);
}
