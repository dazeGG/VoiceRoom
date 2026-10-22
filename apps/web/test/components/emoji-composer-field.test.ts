import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { afterEach, expect, test } from 'vitest';
import ComposerHarness from './harness/ComposerHarness.svelte';
import type { ComposerApi } from './harness/composer-api.ts';
import { defined } from '../helpers/assert.ts';

afterEach(cleanup);

function renderHarness(props: { initial?: string; maxlength?: number }): ComposerApi {
  const handed: { api?: ComposerApi } = {};
  render(ComposerHarness, {
    props: {
      ...props,
      onApi: (api: ComposerApi) => {
        handed.api = api;
      }
    }
  });
  return defined(handed.api, 'the composer harness API');
}

const field = () => screen.getByRole('textbox', { name: 'Сообщение' });
const value = () => screen.getByTestId('value').textContent;

test('emoji show as artwork while the value stays plain text', () => {
  render(ComposerHarness, { props: { initial: 'привет 😀!' } });
  const images = field().querySelectorAll('img');
  expect([...images].map((image) => image.alt)).toEqual(['😀']);
  expect(field().textContent).toBe('привет !');
  expect(value()).toBe('привет 😀!');
});

test('an emoji chosen in the picker lands where the caret was', () => {
  const component = renderHarness({ initial: 'ab' });
  expect(component.insert('🙂', 1)).toBe(true);
  flushSync();
  expect(value()).toBe('a🙂b');
  expect(field().querySelectorAll('img')).toHaveLength(1);
});

test('the length limit is kept when inserting', () => {
  const component = renderHarness({ initial: 'abc', maxlength: 4 });
  expect(component.insert('xyz', 3)).toBe(false);
  flushSync();
  expect(value()).toBe('abc');
});

test('clearing the value from outside (after sending) empties the field', () => {
  const component = renderHarness({ initial: 'текст 😀' });
  component.setValue('');
  flushSync();
  expect(field().textContent).toBe('');
  expect(field().querySelectorAll('img')).toHaveLength(0);
});

test('pasting rich content inserts plain text only', async () => {
  render(ComposerHarness, { props: { initial: '' } });
  const data = {
    getData: (type: string) => (type === 'text/plain' ? 'жирный <b>' : '<b>жирный</b>'),
    types: ['text/plain', 'text/html'],
    files: [],
    items: []
  };
  await fireEvent.paste(field(), { clipboardData: data });
  flushSync();
  expect(value()).toBe('жирный <b>');
  expect(field().querySelector('b')).toBeNull();
});
