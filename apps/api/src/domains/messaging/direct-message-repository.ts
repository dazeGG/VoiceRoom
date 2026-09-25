import type { FriendStore } from '../../lib/friend-store.ts';

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

export type DirectMessageRepository = Readonly<Pick<FriendStore, (typeof METHODS)[number]>>;

function requireMethod(store: Store | null | undefined, name: string): StoreMethod {
  if (!store || typeof store[name] !== 'function') {
    throw new TypeError(`Direct message store must implement ${name}()`);
  }
  return (store[name] as StoreMethod).bind(store);
}

function createDirectMessageRepository({
  store
}: { store?: Store | FriendStore | null } = {}): DirectMessageRepository {
  if (!store) throw new TypeError('Direct message repository requires a store');
  const delegate =
    (name: string): any =>
    (...args: unknown[]) =>
      requireMethod(store as Store, name)(...args);

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
