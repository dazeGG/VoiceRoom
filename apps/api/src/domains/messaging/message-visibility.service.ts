import { isDirectParticipant } from './direct-message.policy.ts';

/** A room page has already checked the viewer may read the room's chat. */
export type RoomVisibilityContext = Readonly<{ authorized: boolean }>;

export type DirectVisibilityContext = Readonly<{
  authorized?: boolean | undefined;
  message?: Readonly<{ senderId: string; recipientId: string }> | null | undefined;
  viewerId?: string | undefined;
  userId?: string | undefined;
}>;

export type MessageVisibilityService = Readonly<{
  canViewDirectMessage(context: DirectVisibilityContext): Promise<boolean>;
  canViewRoomMessage(context: RoomVisibilityContext): Promise<boolean>;
}>;

function createMessageVisibilityService(): MessageVisibilityService {
  async function canViewRoomMessage(context: RoomVisibilityContext): Promise<boolean> {
    return context.authorized;
  }

  async function canViewDirectMessage(context: DirectVisibilityContext): Promise<boolean> {
    if (context.authorized === false) return false;
    if (!context.message) return context.authorized === true;
    return isDirectParticipant(context.message, context.viewerId || context.userId);
  }

  return Object.freeze({ canViewDirectMessage, canViewRoomMessage });
}

export { createMessageVisibilityService };
