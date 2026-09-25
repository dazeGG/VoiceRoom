import { createMessageVisibilityService, type MessageVisibilityService } from './message-visibility-service.ts';

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
  directMessages?: Direct;
  roomMessages?: Room;
  visibility?: MessageVisibilityService;
} = {}): MessageService<Direct, Room> {
  if (!directMessages || !roomMessages) {
    throw new TypeError('Message service requires room and direct message repositories');
  }

  const visibilityPolicy = visibility || createMessageVisibilityService();

  async function withUnitOfWork<T>(operation: (unit: MessagingUnitOfWork<Direct, Room>) => T | Promise<T>): Promise<T> {
    if (typeof operation !== 'function') throw new TypeError('Messaging unit of work must be a function');
    return operation({
      directMessages: directMessages as Direct,
      roomMessages: roomMessages as Room,
      visibility: visibilityPolicy
    });
  }

  return Object.freeze({
    direct: directMessages,
    room: roomMessages,
    visibility: visibilityPolicy,
    withUnitOfWork
  });
}

export { createMessageService };
