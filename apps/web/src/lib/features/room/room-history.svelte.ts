import { tick } from 'svelte';
import { readHistoryCache, writeHistoryCache } from '$lib/shared/chat/history-cache';

export interface AnchoredHistoryPage<T> {
  messages: T[];
  pageInfo: {
    before?: string;
    hasMoreBefore: boolean;
  };
}

interface AnchoredHistoryOptions<T extends { id: string }> {
  loadPage: (
    scope: string,
    request: { mode: 'latest' | 'before' | 'around'; cursor?: string; messageId?: string; signal: AbortSignal }
  ) => Promise<AnchoredHistoryPage<T>>;
  compare?: (left: T, right: T) => number;
  /** Where a scope's newest messages are kept between visits; without it nothing is kept. */
  cacheKey?: (scope: string) => string;
  onChange?: (state: {
    messages: T[];
    loading: boolean;
    loadingOlder: boolean;
    hasMoreBefore: boolean;
    error: string;
  }) => void;
}

export function createAnchoredHistory<T extends { id: string }>(options: AnchoredHistoryOptions<T>) {
  let scope = '';
  let generation = 0;
  let controller: AbortController | null = null;
  let olderPromise: Promise<void> | null = null;
  // The kept copy is shown and the newest page is on its way.
  let revalidating = false;

  const state = $state({
    messages: [] as T[],
    loading: false,
    loadingOlder: false,
    hasMoreBefore: false,
    before: undefined as string | undefined,
    error: ''
  });

  function notify(): void {
    options.onChange?.(state);
  }

  function ordered(items: T[]): T[] {
    return options.compare ? items.sort(options.compare) : items;
  }

  function merge(items: T[]): void {
    const byId = new Map(state.messages.map((item) => [item.id, item]));
    for (const item of items) {
      if (!item?.id) continue;
      const current = byId.get(item.id);
      if (!current) {
        byId.set(item.id, item);
        continue;
      }
      const defined = Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined));
      byId.set(item.id, { ...current, ...defined });
    }
    state.messages = ordered(Array.from(byId.values()));
    notify();
  }

  // What was shown is kept for the next visit, with the edits and messages
  // realtime added while it was open.
  function remember(): void {
    if (!scope || !options.cacheKey || state.loading || revalidating) return;
    writeHistoryCache(options.cacheKey(scope), $state.snapshot(state.messages));
  }

  async function open(nextScope: string, messageId?: string): Promise<void> {
    remember();
    generation += 1;
    const requestGeneration = generation;
    scope = nextScope;
    controller?.abort();
    controller = new AbortController();
    olderPromise = null;
    // A visit to the newest messages starts from the copy kept last time and
    // swaps in the page once it arrives; a linked message has no such copy.
    const cached = !messageId && options.cacheKey ? readHistoryCache<T>(options.cacheKey(nextScope)) : undefined;
    revalidating = Boolean(cached);
    state.messages = cached ? ordered(cached) : [];
    state.loading = !cached;
    state.loadingOlder = false;
    state.before = undefined;
    state.hasMoreBefore = false;
    state.error = '';
    notify();
    try {
      const page = await options.loadPage(
        scope,
        messageId
          ? { mode: 'around', messageId, signal: controller.signal }
          : { mode: 'latest', signal: controller.signal }
      );
      if (requestGeneration !== generation || controller.signal.aborted) return;
      state.messages = ordered([...page.messages]);
      state.before = page.pageInfo.before;
      state.hasMoreBefore = page.pageInfo.hasMoreBefore;
      notify();
    } catch (error) {
      if (requestGeneration !== generation || controller.signal.aborted) return;
      state.error = error instanceof Error ? error.message : 'Не удалось загрузить историю';
      notify();
    } finally {
      if (requestGeneration === generation) {
        revalidating = false;
        state.loading = false;
        notify();
      }
    }
  }

  function loadOlder(scrollElement: HTMLElement | null): Promise<void> {
    if (olderPromise) return olderPromise;
    // The kept copy has no cursor of its own; older pages wait for the page.
    if (revalidating) return Promise.resolve();
    if (!scope || !state.hasMoreBefore || !state.before) return Promise.resolve();
    const requestScope = scope;
    const requestGeneration = generation;
    const cursor = state.before;
    const requestController = new AbortController();
    controller?.signal.addEventListener('abort', () => requestController.abort(), { once: true });
    const previousHeight = scrollElement?.scrollHeight ?? 0;
    const previousTop = scrollElement?.scrollTop ?? 0;
    state.loadingOlder = true;
    state.error = '';
    notify();
    let promise!: Promise<void>;
    promise = (async () => {
      try {
        const page = await options.loadPage(requestScope, { mode: 'before', cursor, signal: requestController.signal });
        if (requestGeneration !== generation || requestScope !== scope || requestController.signal.aborted) return;
        merge(page.messages);
        state.before = page.pageInfo.before;
        state.hasMoreBefore = page.pageInfo.hasMoreBefore;
        notify();
        await tick();
        if (scrollElement && requestGeneration === generation) {
          scrollElement.scrollTop = previousTop + Math.max(0, scrollElement.scrollHeight - previousHeight);
        }
      } catch (error) {
        if (!requestController.signal.aborted && requestGeneration === generation) {
          state.error = error instanceof Error ? error.message : 'Не удалось загрузить старые сообщения';
          notify();
        }
      } finally {
        if (requestGeneration === generation) {
          state.loadingOlder = false;
          notify();
        }
        if (olderPromise === promise) olderPromise = null;
      }
    })();
    olderPromise = promise;
    return olderPromise;
  }

  function upsert(item: T): void {
    merge([item]);
  }

  function remove(id: string): void {
    state.messages = state.messages.filter((item) => item.id !== id);
    notify();
  }

  function reconcileLatest(items: T[], belongsToLatestWindow: (item: T) => boolean): void {
    const incomingIds = new Set(items.map((item) => item.id));
    state.messages = state.messages.filter((item) => !belongsToLatestWindow(item) || incomingIds.has(item.id));
    merge(items);
  }

  function close(): void {
    remember();
    generation += 1;
    scope = '';
    controller?.abort();
    controller = null;
    olderPromise = null;
  }

  return { state, open, loadOlder, upsert, remove, merge, reconcileLatest, close };
}
