import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type ShallowRef,
  type WatchSource
} from 'vue';
import { loadFailure, type LoadFailure } from './load-failure.ts';

/** Keeps the last answer and accepts completion only from the latest request. */
export function useAdminResource<T>(
  fetcher: () => Promise<T>,
  deps: readonly WatchSource<unknown>[],
  { failureText, refreshMs }: { failureText: string; refreshMs?: MaybeRefOrGetter<number | undefined> }
) {
  const data: ShallowRef<T | null> = shallowRef(null);
  const failure = shallowRef<LoadFailure | null>(null);
  const busy = ref(true);
  const loadedAt = ref<number | null>(null);
  const heardAt = ref<number | null>(null);
  const interval = computed(() => toValue(refreshMs));
  let round = 0;
  let askedAt = 0;
  let timer: number | undefined;

  async function load(): Promise<void> {
    const requested = ++round;
    askedAt = Date.now();
    busy.value = true;
    try {
      const result = await fetcher();
      if (requested !== round) return;
      data.value = result;
      failure.value = null;
      loadedAt.value = Date.now();
      heardAt.value = loadedAt.value;
    } catch (cause) {
      if (requested !== round) return;
      failure.value = loadFailure(cause, failureText);
      heardAt.value = Date.now();
    } finally {
      if (requested === round) busy.value = false;
    }
  }

  const reload = () => void load();
  function update(change: (current: T | null) => T): void {
    const next = change(data.value);
    // A read sent before a successful write can still contain the old state.
    round += 1;
    busy.value = false;
    data.value = next;
    heardAt.value = Date.now();
  }

  function poll(): void {
    if (document.visibilityState === 'visible' && !busy.value) reload();
  }

  function schedulePolling(ms: number | undefined): void {
    window.clearInterval(timer);
    timer = ms ? window.setInterval(poll, ms) : undefined;
  }

  function onVisibility(): void {
    const ms = interval.value;
    if (!ms || document.visibilityState !== 'visible' || Date.now() - askedAt < ms) return;
    poll();
    schedulePolling(ms);
  }

  watch(deps, reload);
  watch(interval, schedulePolling);
  onMounted(() => {
    reload();
    if (!refreshMs) return;
    schedulePolling(interval.value);
    document.addEventListener('visibilitychange', onVisibility);
  });
  onBeforeUnmount(() => {
    round += 1;
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisibility);
  });

  return { data, failure, busy, loadedAt, heardAt, reload, update };
}
