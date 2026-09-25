import { cleanup, render } from '@testing-library/svelte';
import { afterEach, expect, test } from 'vitest';
import EmojiText from '../../src/lib/shared/chat/EmojiText.svelte';

afterEach(cleanup);

test('text stays text and each emoji is drawn as artwork that keeps its character', () => {
  const { container } = render(EmojiText, { props: { text: 'ок 👍 и 🇷🇺' } });
  const images = [...container.querySelectorAll('img')];
  expect(images.map((image) => image.getAttribute('alt'))).toEqual(['👍', '🇷🇺']);
  expect(images.every((image) => image.getAttribute('src')?.startsWith('/emoji/'))).toBe(true);
  expect(container.textContent).toBe('ок  и ');
});

test('no whitespace is added around the parts, so names and messages keep their spacing', () => {
  const { container } = render(EmojiText, { props: { text: 'a👍b' } });
  expect(container.innerHTML.replace(/<!--.*?-->/g, '')).toMatch(/^a<[^>]+>.*<\/[^>]+>b$|^a<img[^>]*>b$/);
});
