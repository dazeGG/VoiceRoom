import type { RoomStore } from '../../lib/room-store.ts';

type StoreMethod = (...args: unknown[]) => unknown;
type Store = Record<string, unknown>;

const METHODS = [
  'appendMessage',
  'editMessage',
  'getMessage',
  'listMessages',
  'markRoomChatRead',
  'softDeleteMessage'
] as const;

export type RoomMessageRepository = Readonly<Pick<RoomStore, (typeof METHODS)[number]>>;

function requireMethod(store: Store | null | undefined, name: string): StoreMethod {
  if (!store || typeof store[name] !== 'function') {
    throw new TypeError(`Room message store must implement ${name}()`);
  }
  return (store[name] as StoreMethod).bind(store);
}

function createRoomMessageRepository({ store }: { store?: Store | RoomStore | null } = {}): RoomMessageRepository {
  if (!store) throw new TypeError('Room message repository requires a store');
  // Each method forwards to the store's, checked when first called.
  const delegate = <Name extends keyof RoomMessageRepository>(name: Name): RoomMessageRepository[Name] =>
    ((...args: unknown[]) => requireMethod(store as Store, name)(...args)) as RoomMessageRepository[Name];

  return Object.freeze({
    appendMessage: delegate('appendMessage'),
    editMessage: delegate('editMessage'),
    getMessage: delegate('getMessage'),
    listMessages: delegate('listMessages'),
    markRoomChatRead: delegate('markRoomChatRead'),
    softDeleteMessage: delegate('softDeleteMessage')
  });
}

export { createRoomMessageRepository };
