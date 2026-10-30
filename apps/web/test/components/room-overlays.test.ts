import { screen } from '@testing-library/vue';
import { expect, test } from 'vitest';
import { defineComponent, h } from 'vue';
import RoomOverlays from '@/features/room/components/RoomOverlays.vue';
import { useGuestNameUiStore } from '@/features/room/guest-name-ui.store';
import { renderWithApp } from '../helpers/render.ts';

// The guest name dialog sits in the app shell; while it is open the rest of the shell is inert.
const Shell = defineComponent(() => {
  useGuestNameUiStore().open = true;
  return () => h('div', { class: 'app-shell' }, [h('main', { 'data-testid': 'page' }, 'Комната'), h(RoomOverlays)]);
});

test('a guest name dialog that is open at mount makes the rest of the shell inert', async () => {
  const { pinia } = await renderWithApp(Shell);
  await Promise.resolve();
  expect(screen.getByTestId('page').hasAttribute('inert')).toBe(true);

  useGuestNameUiStore(pinia).open = false;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.getByTestId('page').hasAttribute('inert')).toBe(false);
});
