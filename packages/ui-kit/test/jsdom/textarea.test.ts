import { render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { Textarea } from '@voiceroom/ui-kit/components';

test('the accessible counter updates while typing and respects maxlength', async () => {
  const view = render(Textarea, { props: { maxlength: 3 }, attrs: { 'aria-label': 'Комментарий' } });
  const input = screen.getByRole('textbox', { name: 'Комментарий', description: '0 / 3' });
  await userEvent.type(input, 'Тест');
  expect(screen.getByRole('textbox', { description: '3 / 3' })).toBe(input);
  expect(input).toHaveProperty('value', 'Тес');
  expect(input.getAttribute('aria-invalid')).toBeNull();
  expect(view.emitted('update:modelValue').at(-1)).toEqual(['Тес']);
});

test('a value already above the limit is shown as invalid', async () => {
  render(Textarea, {
    props: { maxlength: 3 },
    attrs: { 'aria-label': 'Комментарий', modelValue: 'Тест' }
  });
  const input = screen.getByRole('textbox', { description: '4 / 3' });
  expect(input.getAttribute('aria-invalid')).toBe('true');
});
