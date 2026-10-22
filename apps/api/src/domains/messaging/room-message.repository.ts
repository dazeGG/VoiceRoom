import type { RoomAccessRepository } from '../rooms/room-access.repository.ts';
import type { RoomChatRepository } from './room-chat.repository.ts';

type RoomMessageSource = RoomChatRepository & Pick<RoomAccessRepository, 'markRoomChatRead'>;

export type RoomMessageRepository = Readonly<
  Pick<
    RoomMessageSource,
    'appendMessage' | 'editMessage' | 'getMessage' | 'listMessages' | 'markRoomChatRead' | 'softDeleteMessage'
  >
>;

function createRoomMessageRepository({ store }: { store: RoomMessageRepository }): RoomMessageRepository {
  // Each method forwards to the store's when called, so a test store that
  // lacks one fails only where the test reaches it.
  return Object.freeze({
    appendMessage: (...args) => store.appendMessage(...args),
    editMessage: (...args) => store.editMessage(...args),
    getMessage: (...args) => store.getMessage(...args),
    listMessages: (...args) => store.listMessages(...args),
    markRoomChatRead: (...args) => store.markRoomChatRead(...args),
    softDeleteMessage: (...args) => store.softDeleteMessage(...args)
  });
}

export { createRoomMessageRepository };
