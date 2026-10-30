// The scrolling body of a chat: staying on the newest message while rows
// resize, loading older history at the top, and jumping to a message. The room
// chat and the direct-message thread both use it, so they scroll the same way.

import { nextTick } from 'vue';
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

/** Starts watching an element and returns what stops it, as a Svelte attachment did. */
export type ChatScrollAttachment = (element: HTMLElement) => () => void;

export function useChatScroll() {
  /** The reader is at the newest message, so new content keeps them there. */
  let pinned = true;
  let scrollElement: HTMLElement | null = null;
  let composerAttachments = 0;

  // Images, link previews and emoji that finish loading (or a resized window)
  // change the height after a message rendered. The observer runs after layout
  // and before paint, so the correction never shows as a jump.
  const heightObserver =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          if (pinned) toBottom();
        });

  /** Watches an element inside the body whose height changes move the newest message. */
  const keepsNewestInView: ChatScrollAttachment = (element) => {
    heightObserver?.observe(element);
    return () => heightObserver?.unobserve(element);
  };

  /** Marks the scrolling element; it is watched like every `keepsNewestInView` element. */
  const body: ChatScrollAttachment = (element) => {
    scrollElement = element;
    const stopWatching = keepsNewestInView(element);
    return () => {
      stopWatching();
      if (scrollElement === element) scrollElement = null;
    };
  };

  /** Tracks whether the reader is at the end, and asks for older history at the top. */
  const onScroll = (loadOlder: (element: HTMLElement) => void): void => {
    const element = scrollElement;
    if (!element) return;
    pinned = element.scrollHeight - element.scrollTop - element.clientHeight <= PINNED_THRESHOLD_PX;
    if (element.scrollTop <= LOAD_OLDER_THRESHOLD_PX) loadOlder(element);
  };

  const toBottom = (): void => {
    if (scrollElement) scrollElement.scrollTop = scrollElement.scrollHeight;
  };

  /**
   * Attachments and emoji fonts resize rows after the first paint, so a single
   * scroll lands short of the newest message. Re-pin across the next frames
   * until the height stops moving.
   */
  async function settle(): Promise<void> {
    await nextTick();
    toBottom();
    pinned = true;
    let lastHeight = scrollElement?.scrollHeight ?? 0;
    for (let attempt = 0; attempt < SETTLE_FRAMES; attempt += 1) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      const element = scrollElement;
      if (!element || !pinned) return;
      if (element.scrollHeight === lastHeight) continue;
      lastHeight = element.scrollHeight;
      toBottom();
    }
  }

  /** A new attachment grows the composer; a reader at the end stays there. */
  function followComposer(attachmentCount: number): void {
    if (attachmentCount === composerAttachments) return;
    composerAttachments = attachmentCount;
    if (pinned) void nextTick().then(toBottom);
  }

  function row(messageId: string): HTMLElement | null {
    return scrollElement?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`) ?? null;
  }

  /** Centre a message and flash it, so the eye lands on the one that was meant. */
  function flash(target: HTMLElement): void {
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.classList.add('message-bubble--highlighted');
    setTimeout(() => target.classList.remove('message-bubble--highlighted'), HIGHLIGHT_MS);
  }

  function jumpTo(messageId: string, onMissing: () => void): void {
    const target = row(messageId);
    if (target) flash(target);
    else onMissing();
  }

  // The emoji picker is owned by each message's hover toolbar, so the menu entry
  // drives that trigger rather than duplicating the popover.
  function openReactionPicker(messageId: string): void {
    queueMicrotask(() => row(messageId)?.querySelector<HTMLButtonElement>('.reaction-picker__button--more')?.click());
  }

  return {
    get pinned() {
      return pinned;
    },
    set pinned(value: boolean) {
      pinned = value;
    },
    get element() {
      return scrollElement;
    },
    body,
    keepsNewestInView,
    onScroll,
    toBottom,
    settle,
    followComposer,
    row,
    flash,
    jumpTo,
    openReactionPicker
  };
}

export type ChatScroll = ReturnType<typeof useChatScroll>;

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
