import {
  computed,
  inject,
  onScopeDispose,
  provide,
  shallowRef,
  toValue,
  type InjectionKey,
  type MaybeRefOrGetter
} from 'vue';

export interface RefreshStatus {
  at: number | null;
  everyMs: number;
  busy: boolean;
  reload: () => void;
  what?: string;
}

type Source<T> = () => T | null;

function pageValue<T>() {
  const source = shallowRef<Source<T>>();
  const value = computed(() => source.value?.() ?? null);

  function report(next: MaybeRefOrGetter<T | null>): void {
    const read = () => toValue(next);
    source.value = read;
    onScopeDispose(() => {
      if (source.value === read) source.value = undefined;
    });
  }

  return { value, report };
}

function createFrame() {
  return { title: pageValue<string>(), refresh: pageValue<RefreshStatus>() };
}

const frameKey: InjectionKey<ReturnType<typeof createFrame>> = Symbol('admin frame');

export function provideFrame() {
  const frame = createFrame();
  provide(frameKey, frame);
  return {
    pageTitle: frame.title.value,
    refresh: frame.refresh.value,
    reportTitle: frame.title.report,
    reportRefresh: frame.refresh.report
  };
}

export function usePageTitle(title: MaybeRefOrGetter<string | null>): void {
  inject(frameKey, null)?.title.report(title);
}

export function useRefreshStatus(status: MaybeRefOrGetter<RefreshStatus | null>): void {
  inject(frameKey, null)?.refresh.report(status);
}
