// One compose store per conversation, so a draft survives switching away and
// back. A plain table: nothing renders from it.

import type { AttachmentContext } from '../../api/attachments';
import { AttachmentComposeStore } from './attachment-compose';

const stores = new Map<string, AttachmentComposeStore>();

export function getAttachmentComposeStore(context: AttachmentContext, contextId: string): AttachmentComposeStore {
  const key = `${context}:${contextId}`;
  let store = stores.get(key);
  if (!store) {
    store = new AttachmentComposeStore(context, contextId);
    stores.set(key, store);
  }
  return store;
}

export function clearAttachmentComposeStores(): void {
  for (const store of stores.values()) store.discard();
  stores.clear();
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith('voice-room:attachment-drafts:')) localStorage.removeItem(key);
    }
  } catch {
    // Storage is unavailable (blocked, or no browser): no drafts were saved there.
  }
}
