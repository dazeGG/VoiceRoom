type StoreMethod = (...args: unknown[]) => unknown;
type Store = Record<string, unknown>;

const METHODS = ['appendMessage', 'editMessage', 'getMessage', 'listMessages', 'markRoomChatRead', 'softDeleteMessage'] as const;

export type RoomMessageRepository = Readonly<Record<(typeof METHODS)[number], StoreMethod>>;

function requireMethod(store: Store | null | undefined, name: string): StoreMethod {
  if (!store || typeof store[name] !== 'function') {
    throw new TypeError(`Room message store must implement ${name}()`);
  }
  return (store[name] as StoreMethod).bind(store);
}

function createRoomMessageRepository({ store }: { store?: Store | null } = {}): RoomMessageRepository {
  if (!store) throw new TypeError('Room message repository requires a store');
  const delegate = (name: string): StoreMethod => (...args) => requireMethod(store, name)(...args);

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
