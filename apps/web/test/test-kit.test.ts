import { screen } from '@testing-library/vue';
import { describe, expect, test } from 'vitest';
import { nextTick, ref } from 'vue';

import ProbePage from './components/ProbePage.ts';
import TitledPanel from './components/TitledPanel.ts';
import { useCounterStore } from './fixtures/counter-store.ts';
import { freshImport } from './helpers/fresh-module.ts';
import { renderWithApp } from './helpers/render.ts';

describe('renderWithApp', () => {
  test('renders a component that reads a store and the current route', async () => {
    await renderWithApp(ProbePage, { route: '/r/42?tab=chat' });
    expect(screen.getByText('0 at /r/42?tab=chat')).toBeTruthy();
  });

  test('a store change on the returned pinia reaches the DOM', async () => {
    const { pinia } = await renderWithApp(ProbePage);
    useCounterStore(pinia).increment();
    await nextTick();
    expect(screen.getByText('1 at /')).toBeTruthy();
  });

  test('a navigation through the returned router updates the component', async () => {
    const { router } = await renderWithApp(ProbePage, {
      extraRoutes: [{ path: '/login', component: ProbePage }]
    });
    expect(screen.getByText('0 at /')).toBeTruthy();
    await router.push('/login');
    expect(await screen.findByText('0 at /login')).toBeTruthy();
  });

  test('passes props and slots to the component and knows the extra routes', async () => {
    const { router } = await renderWithApp(TitledPanel, {
      props: { title: 'Rooms' },
      slots: { default: 'Nothing here yet' },
      extraRoutes: [{ path: '/r/:roomId', name: 'room', component: TitledPanel }]
    });
    expect(screen.getByRole('heading', { name: 'Rooms' })).toBeTruthy();
    expect(screen.getByText('Nothing here yet')).toBeTruthy();
    expect(router.resolve({ name: 'room', params: { roomId: '7' } }).fullPath).toBe('/r/7');
  });
});

describe('cleanup between tests', () => {
  test('the first test renders a text', async () => {
    await renderWithApp(TitledPanel, { props: { title: 'Rooms' } });
    expect(screen.getAllByText('Rooms')).toHaveLength(1);
  });

  test('the second test renders the same text and finds exactly one match', async () => {
    await renderWithApp(TitledPanel, { props: { title: 'Rooms' } });
    expect(screen.getAllByText('Rooms')).toHaveLength(1);
  });
});

describe('freshImport', () => {
  test('module-level state is new after each freshImport', async () => {
    const first = await freshImport(() => import('./fixtures/counter-store.ts'));
    expect(first.countCall()).toBe(1);
    expect(first.countCall()).toBe(2);

    const second = await freshImport(() => import('./fixtures/counter-store.ts'));
    expect(second.countCall()).toBe(1);
    expect(first.countCall()).toBe(3);
  });

  test('a store defined in a fresh module starts from its initial state', async () => {
    const first = await freshImport(() => import('./fixtures/counter-store.ts'));
    first.useCounterStore().increment();
    expect(first.useCounterStore().count).toBe(1);

    const second = await freshImport(() => import('./fixtures/counter-store.ts'));
    expect(second.useCounterStore().count).toBe(0);
  });

  test('vue stays one shared instance across freshImport', async () => {
    const fresh = await freshImport(() => import('./fixtures/counter-store.ts'));
    expect(fresh.vueRef).toBe(ref);
  });
});
