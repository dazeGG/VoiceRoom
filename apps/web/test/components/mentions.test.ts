import { screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import MentionAutocomplete from '@/shared/chat/MentionAutocomplete.vue';
import StructuredMessageContent from '@/shared/chat/StructuredMessageContent.vue';
import type { MembershipRole } from '@voiceroom/shared/contracts/membership';
import type { RoomMessageContentV1 } from '@voiceroom/shared/room-message-content';
import { member } from '../fixtures/answers.ts';
import { defined } from '../helpers/assert.ts';
import { renderWithApp } from '../helpers/render.ts';

const content: RoomMessageContentV1 = {
  version: 1,
  segments: [
    { type: 'text', text: 'привет ' },
    { type: 'mention', userId: 'u-anna', label: 'anna' },
    { type: 'text', text: ', смотри ' },
    { type: 'link', href: 'https://example.com/a', label: 'example.com/a' }
  ]
};

test('a mention in a message opens that person when a handler is given', async () => {
  const onmention = vi.fn();
  await renderWithApp(StructuredMessageContent, { props: { content, onmention } });
  await userEvent.click(screen.getByRole('button', { name: 'Открыть профиль @anna' }));
  expect(onmention).toHaveBeenCalledWith('u-anna', 'anna', expect.any(MouseEvent));
  const link = screen.getByRole('link', { name: 'example.com/a' });
  expect(link.getAttribute('rel')).toBe('noopener noreferrer external');
  expect(link.getAttribute('target')).toBe('_blank');
});

test('without a handler (a quote, a preview) a mention is plain text', async () => {
  await renderWithApp(StructuredMessageContent, { props: { content } });
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByText('@anna')).toBeTruthy();
});

test('a message without structured content shows its plain text', async () => {
  await renderWithApp(StructuredMessageContent, { props: { content: null, fallback: 'просто текст' } });
  expect(screen.getByText('просто текст')).toBeTruthy();
});

test('markdown emphasis spans structured mentions and keeps the profile action', async () => {
  const onmention = vi.fn();
  const { container } = await renderWithApp(StructuredMessageContent, {
    props: {
      content: {
        version: 1,
        segments: [
          { type: 'text', text: '**привет *снова* ' },
          { type: 'mention', userId: 'u-anna', label: 'anna' },
          { type: 'text', text: '** и ~~пока~~' }
        ]
      },
      onmention
    }
  });
  const mention = screen.getByRole('button', { name: 'Открыть профиль @anna' });
  expect(mention.closest('strong')?.textContent).toBe('привет снова @anna');
  expect(container.querySelector('strong em')?.textContent).toBe('снова');
  expect(container.querySelector('del')?.textContent).toBe('пока');
  await userEvent.click(mention);
  expect(onmention).toHaveBeenCalledWith('u-anna', 'anna', expect.any(MouseEvent));
});

test('markdown renders quotes, lists and safe links but leaves user HTML as text', async () => {
  const { container } = await renderWithApp(StructuredMessageContent, {
    props: {
      fallback: [
        '> цитата',
        '- [сайт](https://example.com/docs)',
        '- www.example.net',
        '3. третий',
        '<b>текст</b>',
        '[небезопасная](javascript:alert(1))'
      ].join('\n')
    }
  });
  expect(container.querySelector('blockquote')?.textContent).toBe('цитата');
  expect(container.querySelectorAll('ul li')).toHaveLength(2);
  expect(container.querySelector('ol')?.getAttribute('start')).toBe('3');
  expect(screen.getByRole('link', { name: 'сайт' }).getAttribute('href')).toBe('https://example.com/docs');
  expect(screen.getByRole('link', { name: 'www.example.net' }).getAttribute('href')).toBe('https://www.example.net');
  expect(screen.getAllByRole('link')).toHaveLength(2);
  expect(container.querySelector('b')).toBeNull();
  expect(container.textContent).toContain('<b>текст</b>');
  expect(container.textContent).toContain('[небезопасная](javascript:alert(1))');
});

test('markdown code stays literal and its copy button preserves the exact indentation', async () => {
  const user = userEvent.setup();
  const writeText = vi.spyOn(navigator.clipboard, 'writeText');
  const code = '  if (a < b) {\n    console.log("**text**", "https://example.com");\n  }';
  const { container } = await renderWithApp(StructuredMessageContent, {
    props: { fallback: ['`` a`b ``', '```ts', code, '```'].join('\n') }
  });
  expect(container.querySelector('code')?.textContent).toBe('a`b');
  expect(container.querySelector('pre code')?.textContent).toBe(code);
  expect(screen.queryByRole('link')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Копировать' }));
  expect(writeText).toHaveBeenCalledWith(code);
  expect(screen.getByRole('button', { name: 'Скопировано' })).toBeTruthy();
});

test('a link typed in a message is a link, as in plain text', async () => {
  await renderWithApp(StructuredMessageContent, {
    props: {
      content: {
        version: 1,
        segments: [{ type: 'text', text: 'глянь https://store.steampowered.com/app/413150 вечером' }]
      }
    }
  });
  const link = screen.getByRole('link', { name: 'https://store.steampowered.com/app/413150' });
  expect(link.getAttribute('href')).toBe('https://store.steampowered.com/app/413150');
  expect(link.getAttribute('target')).toBe('_blank');
  expect(link.closest('.structured-message')?.textContent).toBe(
    'глянь https://store.steampowered.com/app/413150 вечером'
  );
});

test('bare links preserve Markdown punctuation in the URL and close surrounding formatting', async () => {
  const url = 'https://example.com/path/*name*/more';
  await renderWithApp(StructuredMessageContent, { props: { fallback: `**~~${url}~~**.` } });
  const link = screen.getByRole('link', { name: url });
  expect(link.getAttribute('href')).toBe(url);
  expect(link.closest('strong del')).toBeTruthy();
  expect(link.closest('.structured-message')?.textContent).toBe(`${url}.`);
});

test('mention suggestions show face, name and login, mark the active one and pick on click', async () => {
  const onSelect = vi.fn();
  const candidate = (userId: string, displayName: string, login: string, role: MembershipRole = 'member') =>
    member({ userId, displayName, login, role, joinedAt: null });
  await renderWithApp(MentionAutocomplete, {
    props: {
      candidates: [candidate('u1', 'Анна', 'anna', 'owner'), candidate('u2', 'Анна', 'anna2')],
      activeIndex: 1,
      onSelect
    }
  });
  const options = screen.getAllByRole('option');
  expect(options.map((option) => option.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
    'А Анна @anna · Создатель',
    'А Анна @anna2'
  ]);
  expect(options[1]?.getAttribute('aria-selected')).toBe('true');
  await userEvent.click(defined(options[0], 'options[0]'));
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }));
});

test('mention suggestions scroll to keep the active option in view in both directions', async () => {
  const candidates = ['anna', 'boris', 'vera'].map((login) => member({ login, userId: login }));
  const view = await renderWithApp(MentionAutocomplete, { props: { candidates, activeIndex: 0 } });
  const menu = screen.getByRole('listbox');
  Object.defineProperty(menu, 'clientHeight', { value: 80 });
  for (const [index, option] of screen.getAllByRole('option').entries()) {
    Object.defineProperty(option, 'offsetTop', { value: index * 40 });
    Object.defineProperty(option, 'offsetHeight', { value: 40 });
  }

  await view.rerender({ candidates, activeIndex: 1 });
  expect(menu.scrollTop).toBe(0);
  await view.rerender({ candidates, activeIndex: 2 });
  expect(menu.scrollTop).toBe(40);
  await view.rerender({ candidates, activeIndex: 0 });
  expect(menu.scrollTop).toBe(0);
});
