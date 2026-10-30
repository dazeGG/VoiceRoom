import { fireEvent, render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import Dialog from '@/shared/ui/Dialog/Dialog.vue';
import HotkeyRecorder from '@/shared/ui/HotkeyRecorder/HotkeyRecorder.vue';

const binding = { altKey: false, code: 'KeyK', ctrlKey: true, metaKey: false, shiftKey: false };

test('records a binding, reports it and stops recording', async () => {
  const onValueChange = vi.fn();
  const onRecordingChange = vi.fn();
  render(HotkeyRecorder, { props: { ariaLabel: 'Микрофон', onValueChange, onRecordingChange } });
  const field = screen.getByRole('button', { name: 'Микрофон' });
  expect(field.textContent.trim()).toBe('Не назначено');
  await userEvent.click(field);
  expect(field.getAttribute('aria-pressed')).toBe('true');
  expect(field.getAttribute('data-hotkey-recorder-recording')).toBe('true');
  expect(onRecordingChange).toHaveBeenLastCalledWith(true);
  await userEvent.keyboard('{Control>}k{/Control}');
  expect(onValueChange).toHaveBeenCalledWith(binding);
  expect(onRecordingChange).toHaveBeenLastCalledWith(false);
  expect(field.getAttribute('aria-pressed')).toBe('false');
  expect(field.getAttribute('data-hotkey-recorder-recording')).toBe('false');
});

test('Escape cancels recording without changing the value', async () => {
  const onValueChange = vi.fn();
  render(HotkeyRecorder, { props: { ariaLabel: 'Микрофон', modelValue: binding, onValueChange } });
  const field = screen.getByRole('button', { name: 'Микрофон' });
  await userEvent.click(field);
  await userEvent.keyboard('{Escape}');
  expect(field.getAttribute('aria-pressed')).toBe('false');
  expect(onValueChange).not.toHaveBeenCalled();
});

test('reset restores the default value and reports it', async () => {
  const onValueChange = vi.fn();
  render(HotkeyRecorder, {
    props: { ariaLabel: 'Микрофон', modelValue: null, defaultValue: binding, onValueChange }
  });
  await userEvent.click(screen.getByRole('button', { name: 'Сбросить: Микрофон' }));
  expect(onValueChange).toHaveBeenCalledWith(binding);
});

test('a disabled recorder does not start recording', async () => {
  render(HotkeyRecorder, { props: { ariaLabel: 'Микрофон', disabled: true } });
  await userEvent.click(screen.getByRole('button', { name: 'Микрофон' }));
  expect(screen.getByRole('button', { name: 'Микрофон' }).getAttribute('aria-pressed')).toBe('false');
});

test('Escape while recording does not close the dialog around it', async () => {
  const onClose = vi.fn();
  const Host = defineComponent({
    render: () =>
      h(Dialog, { open: true, title: 'Настройки', onClose }, () => h(HotkeyRecorder, { ariaLabel: 'Микрофон' }))
  });
  render(Host);
  await userEvent.click(await screen.findByRole('button', { name: 'Микрофон' }));
  await fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', code: 'Escape' });
  expect(onClose).not.toHaveBeenCalled();
  await fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', code: 'Escape' });
  expect(onClose).toHaveBeenCalled();
});
