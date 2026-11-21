import { render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { Checkbox } from '@voice-room/ui/components';

test('clicking the label toggles the checkbox and emits a boolean', async () => {
  const view = render(Checkbox, {
    props: { description: 'Без них не получится восстановить доступ' },
    slots: { default: 'Я сохранил коды' }
  });
  const checkbox = screen.getByRole('checkbox', {
    name: 'Я сохранил коды',
    description: 'Без них не получится восстановить доступ'
  });
  await userEvent.click(screen.getByText('Я сохранил коды'));
  expect(checkbox.getAttribute('aria-checked')).toBe('true');
  await userEvent.click(screen.getByText('Я сохранил коды'));
  expect(checkbox.getAttribute('aria-checked')).toBe('false');
  expect(view.emitted('update:modelValue')).toEqual([[true], [false]]);
});

test('the indeterminate state is exposed as mixed and Space selects it', async () => {
  const view = render(Checkbox, {
    attrs: { modelValue: 'indeterminate' },
    slots: { default: 'Все уведомления' }
  });
  const checkbox = screen.getByRole('checkbox', { name: 'Все уведомления' });
  expect(checkbox.getAttribute('aria-checked')).toBe('mixed');
  await userEvent.tab();
  expect(document.activeElement).toBe(checkbox);
  await userEvent.keyboard(' ');
  expect(checkbox.getAttribute('aria-checked')).toBe('true');
  expect(view.emitted('update:modelValue')).toEqual([[true]]);
});
