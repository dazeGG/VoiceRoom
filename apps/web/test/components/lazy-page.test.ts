// A page that is a chunk of its own shows the loading card while it downloads,
// retries a failed download, and offers a reload instead of a blank screen
// once the retries are spent.

import { render, screen } from '@testing-library/vue';
import { afterEach, expect, test, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { PAGE_LOAD_RETRIES, PAGE_LOAD_RETRY_DELAY_MS, lazyPage } from '@/shared/components/lazy-page';

const Page = defineComponent({
  props: { name: { type: String, required: true } },
  setup: (props) => () => h('p', `страница ${props.name}`)
});

// What a dynamic import resolves to: Vue takes the default export only from a module namespace.
const pageModule = () => ({ default: Page, [Symbol.toStringTag]: 'Module' });
type PageModule = ReturnType<typeof pageModule>;

afterEach(() => {
  vi.useRealTimers();
});

// Twice the sum of the growing retry delays: every retry has run by then.
const allRetriesMs = PAGE_LOAD_RETRY_DELAY_MS * PAGE_LOAD_RETRIES * (PAGE_LOAD_RETRIES + 1);

test('the loading card shows until the page arrives, then the page with its props', async () => {
  let arrive: (module: PageModule) => void = () => {};
  const LazyPage = lazyPage(() => new Promise<PageModule>((resolve) => (arrive = resolve)));
  render(LazyPage, { props: { name: 'лобби' } });

  expect(await screen.findByRole('main', { name: 'Загрузка страницы' })).toBeTruthy();
  arrive(pageModule());
  expect(await screen.findByText('страница лобби')).toBeTruthy();
  expect(screen.queryByRole('main', { name: 'Загрузка страницы' })).toBeNull();
});

test('a download that fails once is retried and the page still opens', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let attempts = 0;
  const LazyPage = lazyPage(async () => {
    attempts += 1;
    if (attempts === 1) throw new TypeError('Failed to fetch dynamically imported module');
    return pageModule();
  });
  render(LazyPage, { props: { name: 'комнаты' } });

  await vi.advanceTimersByTimeAsync(allRetriesMs);
  await nextTick();
  expect(screen.getByText('страница комнаты')).toBeTruthy();
  expect(attempts).toBe(2);
});

test('a download that keeps failing ends on a reload offer, not a blank page', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let attempts = 0;
  const LazyPage = lazyPage(async (): Promise<PageModule> => {
    attempts += 1;
    throw new TypeError('Failed to fetch dynamically imported module');
  });
  render(LazyPage, { props: { name: 'комнаты' } });

  await vi.advanceTimersByTimeAsync(allRetriesMs);
  await nextTick();
  expect(screen.getByRole('heading', { name: 'Не удалось загрузить VoiceRoom' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Обновить' })).toBeTruthy();
  expect(attempts).toBe(PAGE_LOAD_RETRIES + 1);
});
