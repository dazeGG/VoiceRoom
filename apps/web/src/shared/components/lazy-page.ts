// A page that is a chunk of its own. While the chunk downloads it shows the
// loading card instead of nothing; a failed download is retried, and after the
// last retry the page offers a reload instead of staying blank.

import { defineAsyncComponent, type Component } from 'vue';
import PageLoadFailed from './PageLoadFailed.vue';
import PageLoading from './PageLoading.vue';

export const PAGE_LOAD_RETRIES = 2;
export const PAGE_LOAD_RETRY_DELAY_MS = 600;

export function lazyPage<T extends Component>(loader: () => Promise<{ default: T }>): T {
  return defineAsyncComponent({
    loader,
    loadingComponent: PageLoading,
    delay: 0,
    errorComponent: PageLoadFailed,
    onError(_error, retry, fail, attempts) {
      if (attempts <= PAGE_LOAD_RETRIES) window.setTimeout(retry, PAGE_LOAD_RETRY_DELAY_MS * attempts);
      else fail();
    }
  });
}
