import type { ServerEvent } from '@voice-room/shared/contracts/realtime';
import type { ReactionSummary } from '@voice-room/shared/reactions';

type Conversation = { type?: string; id?: string };
type ReactionEvent = Extract<ServerEvent, { type: 'reaction.updated' }>;
type Broadcaster = (id: string, event: ReactionEvent) => unknown;

export type ReactionPublishInput = {
  conversation?: Conversation | null;
  messageId?: string;
  summary?: ReactionSummary | null;
  [key: string]: unknown;
};

export type ReactionRealtimeAdapter = Readonly<{ publish(input?: ReactionPublishInput): Promise<number> }>;

function createReactionRealtimeAdapter({
  broadcastRoom,
  broadcastAccount,
  resolveDirectRecipients
}: {
  broadcastRoom?: Broadcaster;
  broadcastAccount?: Broadcaster;
  resolveDirectRecipients?: (input: ReactionPublishInput) => Iterable<string> | Promise<Iterable<string>>;
} = {}): ReactionRealtimeAdapter {
  const roomBroadcaster: Broadcaster = typeof broadcastRoom === 'function' ? broadcastRoom : () => false;
  const accountBroadcaster: Broadcaster = typeof broadcastAccount === 'function' ? broadcastAccount : () => false;
  const recipientResolver =
    typeof resolveDirectRecipients === 'function' ? resolveDirectRecipients : async (): Promise<Iterable<string>> => [];

  async function publish(input: ReactionPublishInput = {}): Promise<number> {
    const { conversation, messageId, summary } = input;
    const type = conversation?.type;
    if ((type !== 'room' && type !== 'dm') || !conversation?.id || !messageId || !summary) return 0;
    const event: ReactionEvent = {
      type: 'reaction.updated',
      payload: {
        conversation: { type, id: conversation.id },
        ...(type === 'room' ? { roomId: conversation.id } : {}),
        messageId,
        summary
      }
    };

    if (type === 'room') {
      return (await roomBroadcaster(conversation.id, event)) === false ? 0 : 1;
    }

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
