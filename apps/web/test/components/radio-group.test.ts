import { render, screen, waitFor } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { defineComponent, h } from 'vue';
import { RadioGroup, RadioGroupItem } from '@voiceroom/ui-kit/components';

test('an arrow selects the next enabled option and Tab leaves the group', async () => {
  const view = render(RadioGroup, {
    props: {
      modelValue: 'first',
      options: [
        { value: 'first', label: 'Первый' },
        { value: 'second', label: 'Второй', disabled: true },
        { value: 'third', label: 'Третий' }
      ]
    },
    attrs: { 'aria-label': 'Выбор' }
  });
  const first = screen.getByRole('radio', { name: 'Первый', checked: true });
  const third = screen.getByRole('radio', { name: 'Третий' });
  await userEvent.tab();
  expect(document.activeElement).toBe(first);
  await userEvent.keyboard('{ArrowDown}');
  await waitFor(() => expect(third.getAttribute('aria-checked')).toBe('true'));
  expect(document.activeElement).toBe(third);
  expect(view.emitted('update:modelValue')).toEqual([['third']]);
  await userEvent.tab();
  expect(document.activeElement).toBe(document.body);
});

test('the item slot can provide a radio without an options array', async () => {
  render(
    defineComponent({
      setup: () => () =>
        h(
          RadioGroup,
          { 'aria-label': 'Раскладка' },
          {
            item: () =>
              h(
                RadioGroupItem,
                { option: { value: 'grid', label: 'Сетка' }, variant: 'card' },
                {
                  preview: () => h('span', 'Предпросмотр')
                }
              )
          }
        )
    })
  );
  const radio = screen.getByRole('radio', { name: 'Сетка' });
  await userEvent.click(radio);
  expect(radio.getAttribute('aria-checked')).toBe('true');
  expect(screen.getByText('Предпросмотр')).toBeTruthy();
});
