import { expect, test, vi } from 'vitest';
import { sendOrEditLast } from '@/shared/chat/composer-input';

test.each([
  { isComposing: true, keyCode: 13 },
  { isComposing: false, keyCode: 229 }
])('IME confirming Enter is left to the input method: %j', (composition) => {
  const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, ...composition });
  const composer = { empty: false, send: vi.fn(), editLast: vi.fn(() => true) };
  sendOrEditLast(event, composer);
  expect(composer.send).not.toHaveBeenCalled();
  expect(composer.editLast).not.toHaveBeenCalled();
  expect(event.defaultPrevented).toBe(false);
});

test('ordinary Enter sends once and Shift+Enter remains multiline', () => {
  const composer = { empty: false, send: vi.fn(), editLast: vi.fn(() => true) };
  const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
  sendOrEditLast(enter, composer);
  expect(composer.send).toHaveBeenCalledOnce();
  expect(enter.defaultPrevented).toBe(true);
  const newline = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true });
  sendOrEditLast(newline, composer);
  expect(composer.send).toHaveBeenCalledOnce();
  expect(newline.defaultPrevented).toBe(false);
});

test('ArrowUp edits only an empty non-composing field', () => {
  const composer = { empty: true, send: vi.fn(), editLast: vi.fn(() => true) };
  const edit = new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true });
  sendOrEditLast(edit, composer);
  expect(composer.editLast).toHaveBeenCalledOnce();
  expect(edit.defaultPrevented).toBe(true);
  sendOrEditLast(new KeyboardEvent('keydown', { key: 'ArrowUp', isComposing: true }), composer);
  sendOrEditLast(new KeyboardEvent('keydown', { key: 'ArrowUp' }), { ...composer, empty: false });
  expect(composer.editLast).toHaveBeenCalledOnce();
});
