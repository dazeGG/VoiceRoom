import { render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { Switch } from '@voice-room/ui/components';
import { defineComponent, h, ref } from 'vue';

test('click and Space toggle the switch through v-model', async () => {
  const onUpdate = vi.fn();
  const checked = ref(false);
  const Host = defineComponent({
    render: () =>
      h(Switch, {
        modelValue: checked.value,
        ariaLabel: 'Шумоподавление',
        size: 'sm',
        'onUpdate:modelValue': (next: boolean) => {
          checked.value = next;
          onUpdate(next);
        }
      })
  });
  render(Host);
  const toggle = screen.getByRole('switch', { name: 'Шумоподавление', checked: false });
  await userEvent.click(toggle);
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  expect(onUpdate).toHaveBeenLastCalledWith(true);
  await userEvent.keyboard(' ');
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  expect(onUpdate).toHaveBeenLastCalledWith(false);
  expect(onUpdate).toHaveBeenCalledTimes(2);
});

test('reflects the checked state in aria-checked', () => {
  render(Switch, { props: { modelValue: true, ariaLabel: 'Звук' } });
  expect(screen.getByRole('switch', { name: 'Звук' }).getAttribute('aria-checked')).toBe('true');
});

test('a disabled switch does not toggle', async () => {
  const onUpdate = vi.fn();
  render(Switch, { props: { modelValue: false, disabled: true, ariaLabel: 'Звук', 'onUpdate:modelValue': onUpdate } });
  await userEvent.click(screen.getByRole('switch', { name: 'Звук' }));
  expect(onUpdate).not.toHaveBeenCalled();
});
