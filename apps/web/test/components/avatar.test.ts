import { cleanup, render } from '@testing-library/svelte';
import { afterEach, expect, test } from 'vitest';
import Avatar from '../../src/lib/shared/ui/Avatar/Avatar.svelte';

afterEach(cleanup);

const dot = (container: HTMLElement) => container.querySelector<HTMLElement>('.ui-avatar-dot');

test('the presence dot shows do-not-disturb over away over online, and offline otherwise', () => {
  const cases: Array<[Record<string, boolean>, string]> = [
    [{ online: true, dnd: true, afk: true }, 'dnd'],
    [{ online: true, afk: true }, 'afk'],
    [{ online: true }, 'online'],
    [{ online: false }, 'offline']
  ];
  for (const [props, status] of cases) {
    const { container, unmount } = render(Avatar, { props: { name: 'Анна', showDot: true, ...props } });
    expect(dot(container)?.dataset.status).toBe(status);
    unmount();
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
  await Promise.resolve();
  expect(container.querySelector('img')).toBeNull();
  // The first letter, not half of the emoji.
  expect(container.textContent?.trim()).toBe('Б');
});
