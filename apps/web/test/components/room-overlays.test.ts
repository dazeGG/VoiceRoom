import { screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import RoomOverlays from '@/features/room/components/RoomOverlays.vue';
import { useGuestNameUiStore } from '@voiceroom/call/engine/core/guest-name-ui.store';
import { renderWithApp } from '../helpers/render.ts';

const Shell = defineComponent(() => {
  useGuestNameUiStore().open = true;
  return () => h('div', { class: 'app-shell' }, [h('main', 'Комната'), h(RoomOverlays)]);
});

test('the required guest name dialog takes focus and hides the room until it closes', async () => {
  const { pinia } = await renderWithApp(Shell);
  const dialog = await screen.findByRole('dialog', { name: 'Как вас зовут?' });
  const name = screen.getByRole('textbox', { name: 'Ваше имя' });
  await vi.waitFor(() => expect(document.activeElement).toBe(name));
  expect(screen.queryByRole('main')).toBeNull();
  await userEvent.keyboard('{Escape}');
  expect(screen.getByRole('dialog')).toBe(dialog);

  useGuestNameUiStore(pinia).open = false;
  expect((await screen.findByRole('main')).textContent).toBe('Комната');
});
