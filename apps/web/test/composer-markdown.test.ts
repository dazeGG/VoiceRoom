import { expect, test } from 'vitest';
import { formattingAt } from '@/shared/chat/composer-markdown';

test('selected text keeps its selection when bold and italic are combined or removed', () => {
  const initial = { text: 'a hello b', selection: { start: 1, end: 8 } };
  const bold = formattingAt(initial, 'bold');
  expect(bold).toEqual({
    active: false,
    edit: { text: 'a **hello** b', selection: { start: 4, end: 9 } }
  });
  if (!bold) throw new Error('Missing bold edit');
  const italic = formattingAt(bold.edit, 'italic');
  expect(italic).toEqual({
    active: false,
    edit: { text: 'a ***hello*** b', selection: { start: 5, end: 10 } }
  });
  if (!italic) throw new Error('Missing italic edit');
  expect(formattingAt(italic.edit, 'italic')).toEqual({ active: true, edit: bold.edit });
});

test('an inline code delimiter can contain backticks and be toggled off', () => {
  const initial = { text: '`hello', selection: { start: 0, end: 6 } };
  const code = formattingAt(initial, 'code');
  expect(code?.edit.text).toBe('`` `hello ``');
  if (!code) throw new Error('Missing inline code edit');
  expect(formattingAt(code.edit, 'code')).toEqual({ active: true, edit: initial });
});

test('multiline code uses its own lines and preserves indentation and internal fences', () => {
  const selected = '  a\n```\n  b';
  const text = `before ${selected} after`;
  const block = formattingAt({ text, selection: { start: 7, end: 7 + selected.length } }, 'code');
  expect(block?.edit.text).toBe('before \n````\n  a\n```\n  b\n````\n after');
  expect(block?.edit.text.slice(block.edit.selection.start, block.edit.selection.end)).toBe(selected);
  if (!block) throw new Error('Missing fenced code edit');
  expect(formattingAt(block.edit, 'code')?.active).toBe(true);
});
