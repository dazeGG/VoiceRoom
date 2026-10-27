import { render } from '@testing-library/vue';
import { expect, test } from 'vitest';
import Ellipsis from '../../src/shared/ui/Ellipsis/Ellipsis.vue';

test('the text is shown in a truncating span whose title is the full text', () => {
  const { container } = render(Ellipsis, { props: { text: 'Длинное имя' } });
  const element = container.querySelector('span.ellipsis');
  expect(element?.textContent).toBe('Длинное имя');
  expect(element?.getAttribute('title')).toBe('Длинное имя');
  expect(element?.classList.contains('ellipsis--inline')).toBe(false);
});

test('an explicit title, tag and inline flag are honoured, and a slot replaces the text', () => {
  const { container } = render(Ellipsis, {
    props: { text: 'x', title: 'Подсказка', tag: 'div', inline: true },
    slots: { default: 'из слота' }
  });
  const element = container.querySelector('div.ellipsis');
  expect(element?.getAttribute('title')).toBe('Подсказка');
  expect(element?.classList.contains('ellipsis--inline')).toBe(true);
  expect(element?.textContent).toBe('из слота');
});
