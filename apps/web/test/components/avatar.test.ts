import { render, screen, waitFor } from '@testing-library/vue';
import { expect, test, vi } from 'vitest';
import { Avatar } from '@voice-room/ui/components';

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

function mockImageLoads(): Map<string, EventTarget> {
  const requests = new Map<string, EventTarget>();
  class ImageRequest extends EventTarget {
    set src(value: string) {
      requests.set(value, this);
    }
  }
  vi.stubGlobal('Image', ImageRequest);
  return requests;
}

test('a failed avatar request keeps the first letter of the name visible', async () => {
  const requests = mockImageLoads();
  render(Avatar, { props: { name: '🎧 борис', src: '/avatars/b.webp' } });

  await waitFor(() => expect(requests.has('/avatars/b.webp')).toBe(true));
  requests.get('/avatars/b.webp')?.dispatchEvent(new Event('error'));

  expect(screen.getByText('Б')).toBeTruthy();
  expect(screen.queryByRole('img')).toBeNull();
});

test('a new image replaces the fallback when it loads after a failed request', async () => {
  const requests = mockImageLoads();
  const view = render(Avatar, { props: { name: 'Анна', src: '/avatars/old.webp' } });

  await waitFor(() => expect(requests.has('/avatars/old.webp')).toBe(true));
  requests.get('/avatars/old.webp')?.dispatchEvent(new Event('error'));
  expect(screen.getByText('А')).toBeTruthy();

  await view.rerender({ src: '/avatars/new.webp' });
  await waitFor(() => expect(requests.has('/avatars/new.webp')).toBe(true));
  requests.get('/avatars/new.webp')?.dispatchEvent(new Event('load'));

  await waitFor(() => expect(screen.queryByText('А')).toBeNull());
  expect(view.container.querySelector('img')?.getAttribute('src')).toBe('/avatars/new.webp');
  expect(screen.queryByRole('img')).toBeNull();
});
