// The scrolling body of a chat: staying on the newest message while rows
// resize, loading older history at the top, and jumping to a message. The room
// chat and the direct-message thread both use it, so they scroll the same way.

import { tick } from 'svelte';
import type { Attachment } from 'svelte/attachments';
import { copyAttachmentImage } from './attachment-actions';
import { copyText } from '../utils/clipboard';
import type { Attachment as MessageAttachment } from '@voice-room/shared/contracts/messages';

/** Within this many pixels of the end the reader counts as being at the newest message. */
const PINNED_THRESHOLD_PX = 48;
/** Scrolled this close to the top, the older page is asked for. */
const LOAD_OLDER_THRESHOLD_PX = 32;
const SETTLE_FRAMES = 4;
const HIGHLIGHT_MS = 1600;

export type ChatToast = (message: string, options?: { variant?: 'error' }) => void;

export class ChatScroll {
  /** The reader is at the newest message, so new content keeps them there. */
  pinned = true;
  #element: HTMLElement | null = null;
  #composerAttachments = 0;

  // Images, link previews and emoji that finish loading (or a resized window)
  // change the height after a message rendered. The observer runs after layout
  // and before paint, so the correction never shows as a jump.
  #heightObserver =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          if (this.pinned) this.toBottom();
        });

  get element(): HTMLElement | null {
    return this.#element;
  }

  /** Marks the scrolling element; it is watched like every `keepsNewestInView` element. */
  body: Attachment<HTMLElement> = (element) => {
    this.#element = element;
    const stopWatching = this.keepsNewestInView(element);
    return () => {
      stopWatching?.();
      if (this.#element === element) this.#element = null;
    };
  };

  /** Watches an element inside the body whose height changes move the newest message. */
  keepsNewestInView: Attachment<HTMLElement> = (element) => {
    this.#heightObserver?.observe(element);
    return () => this.#heightObserver?.unobserve(element);
  };

  /** Tracks whether the reader is at the end, and asks for older history at the top. */
  onScroll = (loadOlder: (element: HTMLElement) => void): void => {
    const element = this.#element;
    if (!element) return;
    this.pinned = element.scrollHeight - element.scrollTop - element.clientHeight <= PINNED_THRESHOLD_PX;
    if (element.scrollTop <= LOAD_OLDER_THRESHOLD_PX) loadOlder(element);
  };

  toBottom = (): void => {
    if (this.#element) this.#element.scrollTop = this.#element.scrollHeight;
  };

  /**
   * Attachments and emoji fonts resize rows after the first paint, so a single
   * scroll lands short of the newest message. Re-pin across the next frames
   * until the height stops moving.
   */
  async settle(): Promise<void> {
    await tick();
    this.toBottom();
    this.pinned = true;
    let lastHeight = this.#element?.scrollHeight ?? 0;
    for (let attempt = 0; attempt < SETTLE_FRAMES; attempt += 1) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      const element = this.#element;
      if (!element || !this.pinned) return;
      if (element.scrollHeight === lastHeight) continue;
      lastHeight = element.scrollHeight;
      this.toBottom();
    }
  }

  /** A new attachment grows the composer; a reader at the end stays there. */
  followComposer(attachmentCount: number): void {
    if (attachmentCount === this.#composerAttachments) return;
    this.#composerAttachments = attachmentCount;
    if (this.pinned) void tick().then(this.toBottom);
  }

  row(messageId: string): HTMLElement | null {
    return this.#element?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`) ?? null;
  }

  /** Centre a message and flash it, so the eye lands on the one that was meant. */
  flash(row: HTMLElement): void {
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('is-highlighted');
    setTimeout(() => row.classList.remove('is-highlighted'), HIGHLIGHT_MS);
  }

  jumpTo(messageId: string, onMissing: () => void): void {
    const row = this.row(messageId);
    if (row) this.flash(row);
    else onMissing();
  }

  // The emoji picker is owned by each message's hover toolbar, so the menu entry
  // drives that trigger rather than duplicating the popover.
  openReactionPicker(messageId: string): void {
    queueMicrotask(() => this.row(messageId)?.querySelector<HTMLButtonElement>('.reaction-picker-trigger')?.click());
  }
}

export async function copyMessageText(text: string, toast: ChatToast): Promise<void> {
  try {
    await copyText(text);
    toast('Сообщение скопировано');
  } catch {
    toast('Не удалось скопировать', { variant: 'error' });
  }
}

export async function copyMessageImage(image: MessageAttachment, toast: ChatToast): Promise<void> {
  try {
    await copyAttachmentImage(image);
    toast('Изображение скопировано');
  } catch {
    toast('Не удалось скопировать', { variant: 'error' });
  }
}
