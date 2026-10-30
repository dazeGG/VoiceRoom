// The unsent message of one chat: its text and the mentions chosen in it. The
// owner of the chat view holds it, so it outlives the composer when the view
// swaps to another tab. An account keeps it on this device per chat; a guest has
// no account, so their draft lives only as long as the view.

import { ref } from 'vue';
import { loadChatDraft, saveChatDraft, type ChatDraftScope } from './chat-drafts';
import { createMentionComposer } from './mention-composer';

const SAVE_DELAY_MS = 400;

export function useChatDraft(scope: ChatDraftScope) {
  const text = ref('');
  const mentions = createMentionComposer();
  // The account whose saved draft was brought back. Nothing is stored before
  // that, or an empty composer would overwrite the saved one.
  let restoredFor = '';
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Brings back the account's saved draft once, unless something is already typed. */
  function restore(userId: string): void {
    if (!userId || !scope.id || userId === restoredFor) return;
    restoredFor = userId;
    const saved = loadChatDraft(userId, scope);
    if (!saved || text.value) return;
    text.value = saved.text;
    mentions.restore(saved.mentions);
  }

  /** Called by every edit; the save waits for a pause in typing. */
  function schedule(): void {
    if (!restoredFor) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, SAVE_DELAY_MS);
  }

  function persist(): void {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (!restoredFor) return;
    saveChatDraft(restoredFor, scope, { text: text.value, mentions: mentions.selected });
  }

  /** The message went out: nothing is left to keep. */
  function clear(): void {
    text.value = '';
    mentions.reset();
    persist();
  }

  return { text, mentions, restore, schedule, persist, clear };
}

export type ChatDraft = ReturnType<typeof useChatDraft>;
