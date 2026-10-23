// What a chat thread keeps beside its messages: the message being edited, the
// one the composer replies to, the context menu (with the picture it was
// opened on) and the message being reported. The room and direct chats each
// hold one; it also shows every message's reactions as the thread renders it.
import type { Attachment, ReactionSummary } from '@voice-room/shared/contracts/messages';
import { attachmentAt } from './attachment-actions';
import type { ReactionStore } from './reaction-store.svelte';

export interface MenuMessage {
  id: string;
  attachments?: readonly Attachment[] | undefined;
  /** The reactions a history page carried, if it carried them. */
  reactions?: ReactionSummary[] | undefined;
}

export interface OpenedMessageMenu<T> {
  message: T;
  /** The picture the menu was opened on, when it was opened on one. */
  image: Attachment | null;
  x: number;
  y: number;
}

export class MessageMenuState<T extends MenuMessage> {
  editingId = $state('');
  replyTarget = $state<T | null>(null);
  opened = $state<OpenedMessageMenu<T> | null>(null);
  reportedId = $state<string | null>(null);
  /** The thread's composer, bound by the view; replying focuses it. */
  composer = $state<{ focus(): void } | null>(null);

  readonly #reactions: ReactionStore;
  readonly #onEdit: (() => void) | undefined;

  /**
   * Built while the view initialises: it starts the effect that shows each of
   * `messages()`'s reactions. `onEdit` runs whenever an edit starts.
   */
  constructor(options: { reactions: ReactionStore; messages: () => readonly T[]; onEdit?: (() => void) | undefined }) {
    this.#reactions = options.reactions;
    this.#onEdit = options.onEdit;
    $effect(() => {
      for (const message of options.messages()) options.reactions.show(message);
    });
  }

  /** The emoji the viewer has already put on the message the menu is open on. */
  get activeReactions(): string[] {
    const messageId = this.opened?.message.id;
    if (!messageId) return [];
    return this.#reactions
      .forMessage(messageId)
      .filter((summary) => summary.reactedByMe)
      .map((summary) => summary.emoji);
  }

  /** A message being edited takes no menu: the editor owns its right click. */
  open(message: T, event: MouseEvent): void {
    if (this.editingId === message.id) return;
    event.preventDefault();
    this.opened = {
      message,
      image: attachmentAt(event.target, message.attachments),
      x: event.clientX,
      y: event.clientY
    };
  }

  close(): void {
    this.opened = null;
  }

  edit(messageId: string): void {
    this.editingId = messageId;
    this.#onEdit?.();
  }

  stopEditing(): void {
    this.editingId = '';
  }

  /** Arrow-up in an empty composer: edits `lastOwn` unless an edit is already open. */
  editLast(lastOwn: T | undefined): boolean {
    if (this.editingId || !lastOwn) return false;
    this.edit(lastOwn.id);
    return true;
  }

  replyTo(message: T): void {
    this.replyTarget = message;
    this.composer?.focus();
  }

  report(messageId: string): void {
    this.reportedId = messageId;
  }

  closeReport(): void {
    this.reportedId = null;
  }
}
