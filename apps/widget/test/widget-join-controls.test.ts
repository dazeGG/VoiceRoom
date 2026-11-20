import { render, screen, fireEvent } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { WidgetJoinControls } from '@voice-room/ui/widget';

test('join controls update guest fields and keep create separate from join submission', async () => {
  const view = render(WidgetJoinControls);
  await fireEvent.update(screen.getByLabelText('Ваше имя'), 'Гость');
  await fireEvent.update(screen.getByLabelText('Код комнаты'), 'party-code');
  await userEvent.click(screen.getByRole('button', { name: 'Создать комнату' }));
  expect(view.emitted()['update:name']).toEqual([['Гость']]);
  expect(view.emitted()['update:code']).toEqual([['party-code']]);
  expect(view.emitted().create).toHaveLength(1);
  expect(view.emitted().join).toBeUndefined();
  const form = view.container.querySelector('form');
  if (!form) throw new Error('Missing join form');
  await fireEvent.submit(form);
  expect(view.emitted().join).toHaveLength(1);
});

test('preview join controls cannot create, join or acquire media', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  try {
    const view = render(WidgetJoinControls, { props: { preview: true } });
    for (const input of view.container.querySelectorAll('input')) expect(input.disabled).toBe(true);
    for (const button of view.container.querySelectorAll('button')) expect(button.disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Создать комнату' }));
    await userEvent.click(screen.getByRole('button', { name: 'Войти' }));
    expect(view.emitted().create).toBeUndefined();
    expect(view.emitted().join).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    fetchSpy.mockRestore();
  }
});
