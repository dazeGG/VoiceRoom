import type { DmThreadRepository } from './dm-thread.repository.ts';

export type DirectMessageRepository = Readonly<
  Pick<
    DmThreadRepository,
    | 'editMessage'
    | 'expirePendingInvites'
    | 'getMessage'
    | 'listThread'
    | 'markRead'
    | 'respondInvite'
    | 'sendMessage'
    | 'softDeleteMessage'
  >
>;

function createDirectMessageRepository({ store }: { store: DirectMessageRepository }): DirectMessageRepository {
  // Each method forwards to the store's when called, so a test store that
  // lacks one fails only where the test reaches it.
  return Object.freeze({
    editMessage: (...args) => store.editMessage(...args),
    expirePendingInvites: (...args) => store.expirePendingInvites(...args),
    getMessage: (...args) => store.getMessage(...args),
    listThread: (...args) => store.listThread(...args),
    markRead: (...args) => store.markRead(...args),
    respondInvite: (...args) => store.respondInvite(...args),
    sendMessage: (...args) => store.sendMessage(...args),
    softDeleteMessage: (...args) => store.softDeleteMessage(...args)
  });
}

export { createDirectMessageRepository };
