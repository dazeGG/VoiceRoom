import { ref } from 'vue';
import { fetchConversations } from '@/api/dm';
import type { ConversationSummary } from '@voiceroom/shared/contracts/messages';

export function useConversations() {
  const entries = ref<ConversationSummary[]>([]);
  const loaded = ref(false);
  const failed = ref(false);
  let session: AbortController | null = null;
  let refreshing = false;
  let invalidated = false;

  async function refresh(): Promise<void> {
    const signal = session?.signal;
    if (!signal) return;
    invalidated = true;
    if (refreshing) return;
    refreshing = true;
    // Events can arrive during a GET. Coalesce them into a fresh snapshot so a
    // stale list cannot resurrect a removed friend or put an older chat first.
    while (invalidated && !signal.aborted) {
      invalidated = false;
      try {
        const result = await fetchConversations(signal);
        if (!signal.aborted && !invalidated) {
          entries.value = result;
          loaded.value = true;
          failed.value = false;
        }
      } catch {
        if (!signal.aborted && !invalidated) failed.value = true;
      }
    }
    if (!signal.aborted) refreshing = false;
  }

  function stop(): void {
    session?.abort();
    session = null;
    refreshing = false;
    invalidated = false;
    entries.value = [];
    loaded.value = false;
    failed.value = false;
  }

  function start(): void {
    stop();
    session = new AbortController();
    void refresh();
  }

  function remove(peerId: string): void {
    entries.value = entries.value.filter(({ peer }) => peer.id !== peerId);
    void refresh();
  }

  return { entries, loaded, failed, start, stop, refresh, remove };
}
