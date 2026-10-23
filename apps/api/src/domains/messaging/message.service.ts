import type { MessageVisibilityService } from './message-visibility.service.ts';

export type MessagingUnitOfWork<Direct, Room> = {
  directMessages: Direct;
  roomMessages: Room;
  visibility: MessageVisibilityService;
};

export type MessageService<Direct, Room> = Readonly<{
  direct: Direct;
  room: Room;
  visibility: MessageVisibilityService;
  withUnitOfWork<T>(operation: (unit: MessagingUnitOfWork<Direct, Room>) => T | Promise<T>): Promise<T>;
}>;

function createMessageService<Direct, Room>({
  directMessages,
  roomMessages,
  visibility
}: {
  directMessages: Direct;
  roomMessages: Room;
  visibility: MessageVisibilityService;
}): MessageService<Direct, Room> {
  async function withUnitOfWork<T>(operation: (unit: MessagingUnitOfWork<Direct, Room>) => T | Promise<T>): Promise<T> {
    return operation({ directMessages, roomMessages, visibility });
  }

  return Object.freeze({
    direct: directMessages,
    room: roomMessages,
    visibility,
    withUnitOfWork
  });
}

export { createMessageService };
