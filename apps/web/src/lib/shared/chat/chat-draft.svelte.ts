// The unsent message of one chat: its text and the mentions chosen in it. The
// owner of the chat view holds it, so it outlives the composer when the view
// swaps to another tab. An account keeps it on this device per chat; a guest has
// no account, so their draft lives only as long as the view.

import { loadChatDraft, saveChatDraft, type ChatDraftScope } from './chat-drafts';
import { createMentionComposer } from './mention-composer.svelte';

const SAVE_DELAY_MS = 400;

export class ChatDraft {
  text = $state('');
  readonly mentions = createMentionComposer();
  readonly #scope: ChatDraftScope;
  // The account whose saved draft was brought back. Nothing is stored before
  // that, or an empty composer would overwrite the saved one.
  #restoredFor = '';
  #saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(scope: ChatDraftScope) {
    this.#scope = scope;
  }

  /** Brings back the account's saved draft once, unless something is already typed. */
  restore = (userId: string): void => {
    if (!userId || !this.#scope.id || userId === this.#restoredFor) return;
    this.#restoredFor = userId;
    const saved = loadChatDraft(userId, this.#scope);
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
    saveChatDraft(this.#restoredFor, this.#scope, { text: this.text, mentions: this.mentions.selected });
  };

  /** The message went out: nothing is left to keep. */
  clear = (): void => {
    this.text = '';
    this.mentions.reset();
    this.persist();
  };
}
