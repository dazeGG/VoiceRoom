import { screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import MentionAutocomplete from '@/shared/chat/MentionAutocomplete.vue';
import StructuredMessageContent from '@/shared/chat/StructuredMessageContent.vue';
import type { MembershipRole } from '@voice-room/shared/contracts/membership';
import type { RoomMessageContentV1 } from '@voice-room/shared/room-message-content';
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
