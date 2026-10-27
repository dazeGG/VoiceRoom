import { fireEvent, screen } from '@testing-library/vue';
import { expect, test } from 'vitest';
import { nextTick } from 'vue';
import { defined } from '../helpers/assert.ts';
import { renderWithApp } from '../helpers/render.ts';
import { composerHarness, type ComposerApi } from './harness/ComposerHarness.ts';

async function renderHarness(props: { initial?: string; maxlength?: number }): Promise<ComposerApi> {
  const handed: { api?: ComposerApi } = {};
  await renderWithApp(
    composerHarness({
      ...props,
      onApi: (api: ComposerApi) => {
        handed.api = api;
      }
    })
  );
  return defined(handed.api, 'the composer harness API');
}

const field = () => screen.getByRole('textbox', { name: 'Сообщение' });
const value = () => screen.getByTestId('value').textContent;

test('emoji show as artwork while the value stays plain text', async () => {
  await renderWithApp(composerHarness({ initial: 'привет 😀!' }));
  const images = field().querySelectorAll('img');
  expect([...images].map((image) => image.alt)).toEqual(['😀']);
  expect(field().textContent).toBe('привет !');
  expect(value()).toBe('привет 😀!');
});

test('an emoji chosen in the picker lands where the caret was', async () => {
  const component = await renderHarness({ initial: 'ab' });
  expect(component.insert('🙂', 1)).toBe(true);
  await nextTick();
  expect(value()).toBe('a🙂b');
  expect(field().querySelectorAll('img')).toHaveLength(1);
});

test('the length limit is kept when inserting', async () => {
  const component = await renderHarness({ initial: 'abc', maxlength: 4 });
  expect(component.insert('xyz', 3)).toBe(false);
  await nextTick();
  expect(value()).toBe('abc');
});

test('clearing the value from outside (after sending) empties the field', async () => {
  const component = await renderHarness({ initial: 'текст 😀' });
  component.setValue('');
  await nextTick();
  expect(field().textContent).toBe('');
  expect(field().querySelectorAll('img')).toHaveLength(0);
});

test('pasting rich content inserts plain text only', async () => {
  await renderWithApp(composerHarness({ initial: '' }));
  const data = {
    getData: (type: string) => (type === 'text/plain' ? 'жирный <b>' : '<b>жирный</b>'),
    types: ['text/plain', 'text/html'],
    files: [],
    items: []
  };
  await fireEvent.paste(field(), { clipboardData: data });
  await nextTick();
  expect(value()).toBe('жирный <b>');
  expect(field().querySelector('b')).toBeNull();
});
