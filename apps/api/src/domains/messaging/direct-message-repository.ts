type StoreMethod = (...args: unknown[]) => unknown;
type Store = Record<string, unknown>;

const METHODS = [
  'editMessage',
  'expirePendingInvites',
  'getMessage',
  'listThread',
  'markRead',
  'respondInvite',
  'sendMessage',
  'softDeleteMessage'
] as const;

export type DirectMessageRepository = Readonly<Record<(typeof METHODS)[number], StoreMethod>>;

function requireMethod(store: Store | null | undefined, name: string): StoreMethod {
  if (!store || typeof store[name] !== 'function') {
    throw new TypeError(`Direct message store must implement ${name}()`);
  }
  return (store[name] as StoreMethod).bind(store);
}

function createDirectMessageRepository({ store }: { store?: Store | null } = {}): DirectMessageRepository {
  if (!store) throw new TypeError('Direct message repository requires a store');
  const delegate = (name: string): StoreMethod => (...args) => requireMethod(store, name)(...args);

  return Object.freeze({
    editMessage: delegate('editMessage'),
    expirePendingInvites: delegate('expirePendingInvites'),
    getMessage: delegate('getMessage'),
    listThread: delegate('listThread'),
    markRead: delegate('markRead'),
    respondInvite: delegate('respondInvite'),
    sendMessage: delegate('sendMessage'),
    softDeleteMessage: delegate('softDeleteMessage')
  });
}

export { createDirectMessageRepository };
