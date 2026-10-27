// One message renders the same parts in the room and direct chats; the variant
// only changes its class names and where the pictures sit against the text.

import { fireEvent, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { cleanup } from '@testing-library/vue';
import { expect, test, vi } from 'vitest';
import { createReactionStore } from '@/shared/chat/reaction-store';
import { renderWithApp } from '../helpers/render.ts';
import { messageBubbleHarness } from './MessageBubbleHarness.ts';

const picture = {
  id: 'att-1',
  context: 'room',
  order: 0,
  mimeType: 'image/webp',
  bytes: 1000,
  width: 40,
  height: 30,
  state: 'ready',
  url: null
} as const;

const message = {
  id: 'm1',
  text: 'смотри',
  replyPreview: { messageId: 'm0', deleted: false, author: { name: 'Ада' }, text: 'что там?' },
  attachments: [picture]
};

type BubbleOptions = {
  variant?: 'chat-msg' | 'dm-msg';
  userId?: string | undefined;
  editing?: boolean;
  menuOpen?: boolean;
  mentionsMe?: boolean;
  cardText?: string;
};

async function renderBubble(options: BubbleOptions = {}) {
  const reactions = createReactionStore();
  reactions.setConversation({ type: 'room', id: 'kitchen' });
  reactions.applyServer('m1', { emoji: '👍', count: 1, reactedByMe: false, revision: '1' });
  const handlers = { onMenu: vi.fn(), onReply: vi.fn(), onCopy: vi.fn() };
  const view = await renderWithApp(
    messageBubbleHarness({
      message,
      variant: options.variant ?? 'chat-msg',
      reactions,
      userId: 'userId' in options ? options.userId : 'u1',
      ...(options.editing ? { editing: options.editing } : {}),
      ...(options.menuOpen ? { menuOpen: options.menuOpen } : {}),
      ...(options.mentionsMe ? { mentionsMe: options.mentionsMe } : {}),
      ...(options.cardText ? { cardText: options.cardText } : {}),
      ...handlers
    })
  );
  const row = view.container.querySelector<HTMLElement>('[data-message-id="m1"]');
  if (!row) throw new Error('the bubble rendered no message row');
  return { row, handlers };
}

/** The class names of the parts in the message body, in order. */
function partOrder(row: HTMLElement): string[] {
  const body = row.firstElementChild;
  return [...(body?.children ?? [])].map((part) => part.classList[0] ?? '');
}

test('a room message shows its quote, text, then pictures, and marks the menu and a mention', async () => {
  const { row, handlers } = await renderBubble({ menuOpen: true, mentionsMe: true });
  const user = userEvent.setup();

  expect([...row.classList]).toEqual([
    'message-bubble',
    'message-bubble--first',
    'message-bubble--context',
    'message-bubble--mentions-me'
  ]);
  expect(row.firstElementChild?.className).toBe('message-bubble__body');
  expect(partOrder(row)).toEqual(['reply-preview', 'chat-msg-content', 'attachment-mosaic', 'reaction-summary']);
  expect(screen.getByRole('button', { name: 'Добавить реакцию 👍' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Открыть выбор эмодзи' })).toBeTruthy();

  await user.click(screen.getByRole('button', { name: 'Ответить' }));
  await user.click(screen.getByRole('button', { name: 'Копировать текст' }));
  await fireEvent.contextMenu(row);
  expect(handlers.onReply).toHaveBeenCalledTimes(1);
  expect(handlers.onCopy).toHaveBeenCalledTimes(1);
  expect(handlers.onMenu).toHaveBeenCalledTimes(1);
});

test('a direct message shows its pictures above its text in the direct-chat layout', async () => {
  const { row } = await renderBubble({ variant: 'dm-msg' });

  expect([...row.classList]).toEqual(['message-bubble', 'message-bubble--dm', 'message-bubble--first']);
  expect(row.firstElementChild?.className).toBe('message-bubble__body message-bubble__body--dm');
  expect(partOrder(row)).toEqual(['reply-preview', 'attachment-mosaic', 'chat-msg-content', 'reaction-summary']);
});

test('a guest sees reactions but gets no reaction picker in the hover actions', async () => {
  await renderBubble({ userId: undefined });

  expect(screen.getByLabelText('Реакции на сообщение').textContent).toContain('1');
  expect(screen.queryByRole('button', { name: 'Добавить реакцию 👍' })).toBeNull();
  expect(screen.getByRole('toolbar', { name: 'Действия с сообщением' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Открыть выбор эмодзи' })).toBeNull();
});

test('the editor replaces the parts while editing, and a card replaces them for good', async () => {
  const editing = await renderBubble({ editing: true });
  expect(editing.row.querySelector('.message-editor')).toBeTruthy();
  expect(screen.queryByRole('toolbar', { name: 'Действия с сообщением' })).toBeNull();
  cleanup();

  const card = await renderBubble({ variant: 'dm-msg', cardText: 'Приглашение в комнату' });
  expect(card.row.textContent?.trim()).toBe('Приглашение в комнату');
  expect(screen.queryByRole('toolbar', { name: 'Действия с сообщением' })).toBeNull();
});
