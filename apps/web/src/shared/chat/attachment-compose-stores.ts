// One compose store per owner and conversation. Replacing the cache on
// session invalidation also refreshes mounted consumers.

import { shallowRef } from 'vue';
import type { AttachmentContext } from '../../api/attachments';
import { AttachmentComposeStore } from './attachment-compose';

const stores = shallowRef(new Map<string, AttachmentComposeStore>());

export function getAttachmentComposeStore(
  context: AttachmentContext,
  contextId: string,
  ownerId?: string
): AttachmentComposeStore {
  const key = JSON.stringify([ownerId, context, contextId]);
  let store = stores.value.get(key);
  if (!store) {
    store = new AttachmentComposeStore(context, contextId, ownerId);
    stores.value.set(key, store);
  }
  return store;
}

export function clearAttachmentComposeStores(clearStorage = true): void {
  for (const store of stores.value.values()) store.invalidate();
  stores.value = new Map();
  if (!clearStorage) return;
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith('voice-room:attachment-drafts:')) localStorage.removeItem(key);
    }
  } catch {
    // Storage is unavailable (blocked, or no browser): no drafts were saved there.
  }
}
