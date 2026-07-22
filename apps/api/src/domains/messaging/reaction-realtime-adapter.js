'use strict';

function createReactionRealtimeAdapter({ broadcastRoom, broadcastAccount, resolveDirectRecipients } = {}) {
  const roomBroadcaster = typeof broadcastRoom === 'function' ? broadcastRoom : () => false;
  const accountBroadcaster = typeof broadcastAccount === 'function' ? broadcastAccount : () => false;
  const recipientResolver = typeof resolveDirectRecipients === 'function'
    ? resolveDirectRecipients
    : async () => [];

  async function publish(input = {}) {
    const { conversation, messageId, summary } = input;
    if (!conversation?.type || !conversation.id || !messageId || !summary) return 0;
    const event = {
      type: 'reaction.updated',
      payload: {
        conversation,
        roomId: conversation.type === 'room' ? conversation.id : undefined,
        messageId,
        summary
      }
    };

    if (conversation.type === 'room') {
      return roomBroadcaster(conversation.id, event) === false ? 0 : 1;
    }
    if (conversation.type !== 'dm') return 0;

    const recipients = new Set(await recipientResolver(input));
    let published = 0;
    for (const userId of recipients) {
      if (userId && accountBroadcaster(userId, event) !== false) published += 1;
    }
    return published;
  }

  return Object.freeze({ publish });
}

module.exports = { createReactionRealtimeAdapter };
