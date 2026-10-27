import { render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import Slider from '@/shared/ui/Slider/Slider.vue';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
  );
});

test('arrow keys step the value and report it', async () => {
  const onValueChange = vi.fn();
  const onUpdate = vi.fn();
  render(Slider, {
    props: { modelValue: 50, ariaLabel: 'Громкость', onValueChange, 'onUpdate:modelValue': onUpdate }
  });
  const slider = await screen.findByRole('slider', { name: 'Громкость' });
  slider.focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(onUpdate).toHaveBeenLastCalledWith(51);
  expect(onValueChange).toHaveBeenLastCalledWith(51);
});

test('Home and End jump to the limits and the value stays clamped', async () => {
  const onValueChange = vi.fn();
  render(Slider, { props: { modelValue: 5, min: 0, max: 10, ariaLabel: 'Уровень', onValueChange } });
  (await screen.findByRole('slider', { name: 'Уровень' })).focus();
  await userEvent.keyboard('{End}');
  expect(onValueChange).toHaveBeenLastCalledWith(10);
  await userEvent.keyboard('{Home}');
  expect(onValueChange).toHaveBeenLastCalledWith(0);
});

test('exposes its value and value text for assistive tech', async () => {
  render(Slider, { props: { modelValue: 30, ariaLabel: 'Громкость', ariaValueText: '30 процентов' } });
  const slider = await screen.findByRole('slider', { name: 'Громкость' });
  expect(slider.getAttribute('aria-valuenow')).toBe('30');
  expect(slider.getAttribute('aria-valuetext')).toBe('30 процентов');
});

test('a disabled slider ignores the keyboard', async () => {
  const onValueChange = vi.fn();
  render(Slider, { props: { modelValue: 50, disabled: true, ariaLabel: 'Громкость', onValueChange } });
  (await screen.findByRole('slider', { name: 'Громкость' })).focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(onValueChange).not.toHaveBeenCalled();
});
