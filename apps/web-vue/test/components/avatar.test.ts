import { render } from '@testing-library/vue';
import { nextTick } from 'vue';
import { expect, test } from 'vitest';
import Avatar from '../../src/shared/ui/Avatar/Avatar.vue';

const dot = (container: Element) => container.querySelector('.ui-avatar__dot');
const statusOf = (element: Element | null) =>
  ['dnd', 'afk', 'online', 'offline'].find((status) => element?.classList.contains(`ui-avatar__dot--${status}`));

test('the presence dot shows do-not-disturb over away over online, and offline otherwise', () => {
  const cases: Array<[Record<string, boolean>, string]> = [
    [{ online: true, dnd: true, afk: true }, 'dnd'],
    [{ online: true, afk: true }, 'afk'],
    [{ online: true }, 'online'],
    [{ online: false }, 'offline']
  ];
  for (const [props, status] of cases) {
    const view = render(Avatar, { props: { name: 'Анна', showDot: true, ...props } });
    expect(statusOf(dot(view.container))).toBe(status);
    view.unmount();
  }
});

test('there is no dot unless asked for', () => {
  const { container } = render(Avatar, { props: { name: 'Анна', online: true } });
  expect(dot(container)).toBeNull();
});

test('an uploaded image is shown and falls back to the initial when it fails to load', async () => {
  const { container } = render(Avatar, { props: { name: '🎧 борис', src: '/avatars/b.webp' } });
  const image = container.querySelector('img');
  expect(image?.getAttribute('src')).toBe('/avatars/b.webp');
  image?.dispatchEvent(new Event('error'));
  await nextTick();
  expect(container.querySelector('img')).toBeNull();
  // The first letter, not half of the emoji.
  expect(container.textContent?.trim()).toBe('Б');
});

test('a new image gets a fresh attempt after the previous one failed', async () => {
  const view = render(Avatar, { props: { name: 'Анна', src: '/avatars/old.webp' } });
  const { container } = view;
  container.querySelector('img')?.dispatchEvent(new Event('error'));
  await nextTick();
  expect(container.querySelector('img')).toBeNull();

  await view.rerender({ name: 'Анна', src: '/avatars/new.webp' });
  expect(container.querySelector('img')?.getAttribute('src')).toBe('/avatars/new.webp');
});
