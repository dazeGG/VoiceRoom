import { render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { Field, NumberField } from '@voiceroom/ui-kit/components';
import { stubOverlayDom } from '../helpers/overlay-dom';

beforeEach(stubOverlayDom);

test('the steppers emit numbers and disable at their corresponding bounds', async () => {
  const change = vi.fn<(value: number | null) => void>();
  render(
    defineComponent({
      setup() {
        const value = ref<number | null>(4);
        return () =>
          h(
            Field,
            { label: 'Отступ, px' },
            {
              default: () =>
                h(NumberField, {
                  min: 0,
                  max: 8,
                  step: 4,
                  modelValue: value.value,
                  'onUpdate:modelValue': (next: number | null) => {
                    value.value = next;
                    change(next);
                  }
                })
            }
          );
      }
    })
  );

  const input = screen.getByRole('spinbutton', { name: 'Отступ, px' });
  const decrease = screen.getByRole('button', { name: 'Уменьшить значение' });
  const increase = screen.getByRole('button', { name: 'Увеличить значение' });
  await userEvent.click(increase);
  expect(change).toHaveBeenLastCalledWith(8);
  expect(input.getAttribute('aria-valuenow')).toBe('8');
  expect(increase).toHaveProperty('disabled', true);
  await userEvent.click(increase);
  expect(change).toHaveBeenCalledTimes(1);
  await userEvent.click(decrease);
  await userEvent.click(decrease);
  expect(change.mock.calls).toEqual([[8], [4], [0]]);
  expect(input.getAttribute('aria-valuenow')).toBe('0');
  expect(decrease).toHaveProperty('disabled', true);
  expect(increase).toHaveProperty('disabled', false);
});
