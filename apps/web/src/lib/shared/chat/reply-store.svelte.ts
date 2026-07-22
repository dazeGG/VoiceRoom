export type ReplyConversation = { type: 'room' | 'dm'; id: string };

export interface ReplyAuthor {
  id?: string;
  name?: string;
}

export interface ReplyTarget {
  messageId: string;
  deleted: boolean;
  author?: ReplyAuthor;
  text?: string;
}

export interface ReplySendInput {
  conversation: ReplyConversation;
  text: string;
  replyTo: Readonly<{ messageId: string }>;
}

function conversationKey(conversation: ReplyConversation): string {
  return `${conversation.type}:${conversation.id}`;
}

function normalizeTarget(target: ReplyTarget | null | undefined): ReplyTarget | null {
  if (!target?.messageId) return null;
  return {
    messageId: String(target.messageId),
    deleted: Boolean(target.deleted),
    author: target.author ? { id: target.author.id, name: target.author.name } : undefined,
    text: typeof target.text === 'string' ? target.text : undefined
  };
}

export class ReplyStore {
  conversation = $state<ReplyConversation | null>(null);
  target = $state<ReplyTarget | null>(null);
  sending = $state(false);
  error = $state('');
  focusRequest = $state(0);
  jumpRequest = $state('');
  private drafts = $state<Record<string, string>>({});

  get draft(): string {
    return this.conversation ? this.drafts[conversationKey(this.conversation)] || '' : '';
  }

  setConversation(conversation: ReplyConversation): void {
    const previous = this.conversation ? conversationKey(this.conversation) : '';
    const next = conversationKey(conversation);
    if (previous !== next) {
      this.target = null;
      this.error = '';
      this.jumpRequest = '';
    }
    this.conversation = { ...conversation };
  }

  setDraft(value: string): void {
    if (!this.conversation) return;
    this.drafts[conversationKey(this.conversation)] = value;
  }

  begin(target: ReplyTarget): void {
    const normalized = normalizeTarget(target);
    if (!normalized || normalized.deleted) return;
    this.target = normalized;
    this.error = '';
    this.requestFocus();
  }

  cancel(): void {
    this.target = null;
    this.error = '';
    this.requestFocus();
  }

  requestFocus(): void {
    this.focusRequest += 1;
  }

  requestJump(messageId = this.target?.messageId || ''): void {
    if (!messageId) return;
    this.jumpRequest = messageId;
  }

  consumeJump(): string {
    const messageId = this.jumpRequest;
    this.jumpRequest = '';
    return messageId;
  }

  markTargetUnavailable(messageId: string): void {
    if (this.target?.messageId !== messageId) return;
    this.target = {
      messageId,
      deleted: true,
      text: 'Сообщение недоступно'
    };
  }

  async submit(send: (input: ReplySendInput) => Promise<unknown>): Promise<boolean> {
    const conversation = this.conversation;
    const target = this.target;
    const text = this.draft.trim();
    if (!conversation || !target || target.deleted || !text || this.sending) return false;

    this.sending = true;
    this.error = '';
    try {
      await send({
        conversation: { ...conversation },
        text,
        replyTo: Object.freeze({ messageId: target.messageId })
      });
      this.drafts[conversationKey(conversation)] = '';
      this.target = null;
      this.requestFocus();
      return true;
    } catch (error) {
      this.error = error instanceof Error && error.message
        ? error.message
        : 'Не удалось отправить ответ';
      return false;
    } finally {
      this.sending = false;
    }
  }

  reset(): void {
    this.conversation = null;
    this.target = null;
    this.sending = false;
    this.error = '';
    this.focusRequest = 0;
    this.jumpRequest = '';
    this.drafts = {};
  }
}

export function createReplyStore(): ReplyStore {
  return new ReplyStore();
}

export const replyStore = createReplyStore();
