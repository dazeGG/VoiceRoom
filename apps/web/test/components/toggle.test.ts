import { render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { Toggle } from '@voice-room/ui/components';

test('click and Space flip aria-pressed and emit update:pressed', async () => {
  const view = render(Toggle, { slots: { default: 'Жирный' } });
  const toggle = screen.getByRole('button', { name: 'Жирный', pressed: false });
  await userEvent.click(toggle);
  expect(toggle.getAttribute('aria-pressed')).toBe('true');
  expect(view.emitted('update:pressed')).toEqual([[true]]);
  await userEvent.keyboard(' ');
  expect(toggle.getAttribute('aria-pressed')).toBe('false');
  expect(view.emitted('update:pressed')).toEqual([[true], [false]]);
});

test('a parent can control the pressed model and receives each changed value', async () => {
  const onUpdate = vi.fn();
  const host = defineComponent({
    setup() {
      const pressed = ref(true);
      return () =>
        h(
          Toggle,
          {
            pressed: pressed.value,
            'onUpdate:pressed': (value: boolean) => {
              pressed.value = value;
              onUpdate(value);
            }
          },
          () => 'Звук'
        );
    }
  });
  render(host);
  const toggle = screen.getByRole('button', { name: 'Звук', pressed: true });
  await userEvent.tab();
  await userEvent.keyboard(' ');
  expect(toggle.getAttribute('aria-pressed')).toBe('false');
  expect(onUpdate).toHaveBeenLastCalledWith(false);
  await userEvent.click(toggle);
  expect(toggle.getAttribute('aria-pressed')).toBe('true');
  expect(onUpdate).toHaveBeenLastCalledWith(true);
});

test('a disabled toggle keeps its state and emits no change', async () => {
  const view = render(Toggle, { props: { disabled: true, pressed: true }, slots: { default: 'Жирный' } });
  const toggle = screen.getByRole('button', { name: 'Жирный', pressed: true });
  expect(toggle).toHaveProperty('disabled', true);
  await userEvent.click(toggle);
  await userEvent.tab();
  await userEvent.keyboard(' ');
  expect(toggle.getAttribute('aria-pressed')).toBe('true');
  expect(view.emitted('update:pressed')).toBeUndefined();
});
