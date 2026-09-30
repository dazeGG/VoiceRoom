// The unsent room message: its text and the mentions chosen in it. The chat
// panel owns it, so it outlives the composer when the panel shows the
// participants tab. An account keeps it on this device per room; a guest has
// no account, so their draft lives only as long as the panel.

import type { RoomMessageContentV1 } from '@voice-room/shared/room-message-content';
import { loadChatDraft, saveChatDraft } from '$lib/shared/chat/chat-drafts';
import { createMentionComposer } from '$lib/shared/chat/mention-composer.svelte';

const SAVE_DELAY_MS = 400;

/** What the composer hands the panel to post. */
export interface OutgoingRoomMessage {
  text: string;
  content: RoomMessageContentV1 | undefined;
  attachmentIds: string[];
  replyTo: { messageId: string } | undefined;
}

export class RoomChatDraft {
  text = $state('');
  readonly mentions = createMentionComposer();
  readonly #roomId: string;
  // The account whose saved draft was brought back. Nothing is stored before
  // that, or an empty composer would overwrite the saved one.
  #restoredFor = '';
  #saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(roomId: string) {
    this.#roomId = roomId;
  }

  /** Brings back the account's saved draft once, unless something is already typed. */
  restore = (userId: string): void => {
    if (!userId || !this.#roomId || userId === this.#restoredFor) return;
    this.#restoredFor = userId;
    const saved = loadChatDraft(userId, { type: 'room', id: this.#roomId });
    if (!saved || this.text) return;
    this.text = saved.text;
    this.mentions.restore(saved.mentions);
  };

  /** Called by every edit; the save waits for a pause in typing. */
  schedule = (): void => {
    if (!this.#restoredFor) return;
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(this.persist, SAVE_DELAY_MS);
  };

  persist = (): void => {
    if (this.#saveTimer) {
      clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
    }
    if (!this.#restoredFor) return;
    saveChatDraft(
      this.#restoredFor,
      { type: 'room', id: this.#roomId },
      { text: this.text, mentions: this.mentions.selected }
    );
  };

  /** The message went out: nothing is left to keep. */
  clear = (): void => {
    this.text = '';
    this.mentions.reset();
    this.persist();
  };
}
