type Conversation = { type?: string; id?: string };
type ReactionEvent = {
  type: 'reaction.updated';
  payload: { conversation: Conversation; roomId: string | undefined; messageId: string; summary: unknown };
};
type Broadcaster = (id: string, event: ReactionEvent) => unknown;

export type ReactionPublishInput = {
  conversation?: Conversation | null;
  messageId?: string;
  summary?: unknown;
  [key: string]: unknown;
};

export type ReactionRealtimeAdapter = Readonly<{ publish(input?: ReactionPublishInput): Promise<number> }>;

function createReactionRealtimeAdapter({ broadcastRoom, broadcastAccount, resolveDirectRecipients }: {
  broadcastRoom?: Broadcaster;
  broadcastAccount?: Broadcaster;
  resolveDirectRecipients?: (input: ReactionPublishInput) => Iterable<string> | Promise<Iterable<string>>;
} = {}): ReactionRealtimeAdapter {
  const roomBroadcaster: Broadcaster = typeof broadcastRoom === 'function' ? broadcastRoom : () => false;
  const accountBroadcaster: Broadcaster = typeof broadcastAccount === 'function' ? broadcastAccount : () => false;
  const recipientResolver = typeof resolveDirectRecipients === 'function'
    ? resolveDirectRecipients
    : async (): Promise<Iterable<string>> => [];

  async function publish(input: ReactionPublishInput = {}): Promise<number> {
    const { conversation, messageId, summary } = input;
    if (!conversation?.type || !conversation.id || !messageId || !summary) return 0;
    const event: ReactionEvent = {
      type: 'reaction.updated',
      payload: {
        conversation,
        roomId: conversation.type === 'room' ? conversation.id : undefined,
        messageId,
        summary
      }
    };

    if (conversation.type === 'room') {
      return (await roomBroadcaster(conversation.id, event)) === false ? 0 : 1;
    }
    if (conversation.type !== 'dm') return 0;

    const recipients = new Set(await recipientResolver(input));
    let published = 0;
    for (const userId of recipients) {
      if (userId && (await accountBroadcaster(userId, event)) !== false) published += 1;
    }
    return published;
  }

  return Object.freeze({ publish });
}

export { createReactionRealtimeAdapter };
