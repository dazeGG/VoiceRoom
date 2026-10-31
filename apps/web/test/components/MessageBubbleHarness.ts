// Test component: one bubble with its text as the content slot and, when given,
// a card in place of every part.

import type { Attachment } from '@voice-room/shared/contracts/messages';
import { defineComponent, h } from 'vue';
import MessageBubble from '@/shared/chat/MessageBubble.vue';
import type { ReactionStore } from '@/shared/chat/reaction-store';
import type { ReplyTarget } from '@/shared/chat/reply-store';

export type MessageBubbleHarnessProps = {
  message: { id: string; text: string; replyPreview?: ReplyTarget; attachments?: Attachment[] };
  variant: 'chat-msg' | 'dm-msg';
  reactions: ReactionStore;
  userId: string | undefined;
  editing?: boolean;
  menuOpen?: boolean;
  mentionsMe?: boolean;
  cardText?: string;
  onMenu: (event: MouseEvent) => void;
  onReply: () => void;
  onCopy: () => void;
};

/** A component rendering one bubble with the given options. */
export function messageBubbleHarness(props: MessageBubbleHarnessProps) {
  return defineComponent(
    () => () =>
      h(
        MessageBubble,
        {
          message: props.message,
          text: props.message.text,
          variant: props.variant,
          maxlength: 500,
          first: true,
          editing: props.editing ?? false,
          menuOpen: props.menuOpen ?? false,
          mentionsMe: props.mentionsMe ?? false,
          reactions: props.reactions,
          userId: props.userId,
          onSaveEdit: async () => {},
          onMenu: props.onMenu,
          onReply: props.onReply,
          onCopy: props.onCopy
        },
        {
          content: () => h('span', { class: 'chat-msg-content' }, props.message.text),
          ...(props.cardText ? { card: () => h('p', props.cardText) } : {})
        }
      )
  );
}
