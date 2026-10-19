import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import MentionAutocomplete from '../../src/lib/shared/chat/MentionAutocomplete.svelte';
import StructuredMessageContent from '../../src/lib/shared/chat/StructuredMessageContent.svelte';
import type { MembershipRole } from '@voice-room/shared/contracts/membership';
import type { RoomMessageContentV1 } from '@voice-room/shared/room-message-content';
import { member } from '../fixtures/answers.ts';

afterEach(cleanup);

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
  render(StructuredMessageContent, { props: { content, onmention } });
  await userEvent.click(screen.getByRole('button', { name: 'Открыть профиль @anna' }));
  expect(onmention).toHaveBeenCalledWith('u-anna', 'anna', expect.any(MouseEvent));
  const link = screen.getByRole('link', { name: 'example.com/a' });
  expect(link.getAttribute('rel')).toBe('noopener noreferrer external');
  expect(link.getAttribute('target')).toBe('_blank');
});

test('without a handler (a quote, a preview) a mention is plain text', () => {
  render(StructuredMessageContent, { props: { content } });
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByText('@anna')).toBeTruthy();
});

test('a message without structured content shows its plain text', () => {
  render(StructuredMessageContent, { props: { content: null, fallback: 'просто текст' } });
  expect(screen.getByText('просто текст')).toBeTruthy();
});

test('a link typed in a message is a link, as in plain text', () => {
  render(StructuredMessageContent, {
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

test('mention suggestions show face, name and login, mark the active one and pick on click', async () => {
  const onselect = vi.fn();
  const candidate = (userId: string, displayName: string, login: string, role: MembershipRole = 'member') =>
    member({ userId, displayName, login, role, joinedAt: null });
  render(MentionAutocomplete, {
    props: {
      candidates: [candidate('u1', 'Анна', 'anna', 'owner'), candidate('u2', 'Анна', 'anna2')],
      activeIndex: 1,
      onselect
    }
  });
  const options = screen.getAllByRole('option');
  expect(options.map((option) => option.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
    'А Анна @anna · Создатель',
    'А Анна @anna2'
  ]);
  expect(options[1]?.getAttribute('aria-selected')).toBe('true');
  await userEvent.click(options[0]);
  expect(onselect).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }));
});
