type Loose = Record<string, unknown>;

export type VisibilityContext =
  | {
      authorized?: unknown;
      room?: { deletedAt?: unknown; deleted_at?: unknown } | null;
      message?: Loose | null;
      viewerId?: string;
      userId?: string;
      [key: string]: unknown;
    }
  | null
  | undefined;

export interface VisibilityPolicy {
  canView(context: VisibilityContext): boolean | Promise<boolean>;
}

export type MessageVisibilityService = Readonly<{
  canViewDirectMessage(context: VisibilityContext): Promise<boolean>;
  canViewRoomMessage(context: VisibilityContext): Promise<boolean>;
  requireDirectMessage(context: VisibilityContext): Promise<Loose | null>;
  requireRoomMessage(context: VisibilityContext): Promise<Loose | null>;
}>;

class MessageVisibilityError extends Error {
  declare code: string;

  constructor() {
    super('Message is not visible');
    this.name = 'MessageVisibilityError';
    this.code = 'message_not_visible';
  }
}

function participantIds(message: Loose | null | undefined): Set<unknown> {
  return new Set(
    [message?.senderId || message?.sender_id, message?.recipientId || message?.recipient_id].filter(Boolean)
  );
}

function createMessageVisibilityService({
  roomAdapter,
  directAdapter
}: {
  roomAdapter?: VisibilityPolicy;
  directAdapter?: VisibilityPolicy;
} = {}): MessageVisibilityService {
  const roomPolicy: VisibilityPolicy = roomAdapter || {
    canView(context) {
      if (typeof context?.authorized === 'boolean') return context.authorized;
      return Boolean(context?.room && !context.room.deletedAt && !context.room.deleted_at);
    }
  };
  const directPolicy: VisibilityPolicy = directAdapter || {
    canView(context) {
      if (context?.authorized === false) return false;
      const viewerId = context?.viewerId || context?.userId;
      if (!context?.message) return context?.authorized === true;
      return Boolean(viewerId && participantIds(context.message).has(viewerId));
    }
  };

  async function canViewRoomMessage(context: VisibilityContext): Promise<boolean> {
    return (await roomPolicy.canView(context)) === true;
  }

  async function canViewDirectMessage(context: VisibilityContext): Promise<boolean> {
    return (await directPolicy.canView(context)) === true;
  }

  async function requireRoomMessage(context: VisibilityContext): Promise<Loose | null> {
    if (!(await canViewRoomMessage(context))) throw new MessageVisibilityError();
    return context?.message || null;
  }

  async function requireDirectMessage(context: VisibilityContext): Promise<Loose | null> {
    if (!(await canViewDirectMessage(context))) throw new MessageVisibilityError();
    return context?.message || null;
  }

  return Object.freeze({
    canViewDirectMessage,
    canViewRoomMessage,
    requireDirectMessage,
    requireRoomMessage
  });
}

export { MessageVisibilityError, createMessageVisibilityService };
