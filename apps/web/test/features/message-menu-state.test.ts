// The state a chat thread keeps beside its messages: the context menu, the
// edit, the reply target and the report, and the reactions of what it shows.

import { effectScope, nextTick, reactive } from 'vue';
import { afterEach, expect, test, vi } from 'vitest';
import { MessageMenuState, type MenuMessage } from '@/shared/chat/message-menu-state';
import { createReactionStore } from '@/shared/chat/reaction-store';
import { stubFetch } from '../fixtures/fetch.ts';

const picture = {
  id: 'att-1',
  context: 'dm',
  order: 0,
  mimeType: 'image/webp',
  bytes: 1000,
  width: 40,
  height: 30,
  state: 'ready',
  url: null
} as const;

const scopes: ReturnType<typeof effectScope>[] = [];
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop();
  document.body.replaceChildren();
});

function setup(messages: MenuMessage[] = [], onEdit?: () => void) {
  const reactions = createReactionStore();
  reactions.setConversation({ type: 'dm', id: 'peer' });
  const shown = reactive({ messages });
  let menu: MessageMenuState<MenuMessage> | undefined;
  const scope = effectScope();
  scopes.push(scope);
  scope.run(() => {
    menu = new MessageMenuState<MenuMessage>({ reactions, messages: () => shown.messages, onEdit });
  });
  if (!menu) throw new Error('the menu state was not built');
  return { menu, reactions, shown };
}

/** Right-clicks `target`, a node inside a message row that opens `message`'s menu. */
function rightClick(menu: MessageMenuState<MenuMessage>, message: MenuMessage, target: Element): MouseEvent {
  const row = document.createElement('div');
  row.append(target);
  document.body.append(row);
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 12, clientY: 34 });
  row.addEventListener('contextmenu', (opened) => menu.open(message, opened));
  target.dispatchEvent(event);
  return event;
}

test('a right-click opens the menu where it happened, with the picture it landed on', () => {
  const { menu } = setup();
  const message = { id: 'm1', attachments: [picture] };
  const image = document.createElement('img');
  image.dataset.attachmentId = 'att-1';

  const event = rightClick(menu, message, image);

  expect(event.defaultPrevented).toBe(true);
  expect(menu.opened).toEqual({ message, image: picture, x: 12, y: 34 });
  rightClick(menu, message, document.createElement('span'));
  expect(menu.opened?.image).toBeNull();
  menu.close();
  expect(menu.opened).toBeNull();
});

test('the message being edited takes no menu, so the browser keeps its own', () => {
  const { menu } = setup();
  menu.edit('m1');

  const event = rightClick(menu, { id: 'm1' }, document.createElement('span'));

  expect(event.defaultPrevented).toBe(false);
  expect(menu.opened).toBeNull();
});

test('editing the last own message works once and reports every edit start', () => {
  const onEdit = vi.fn();
  const { menu } = setup([], onEdit);

  expect(menu.editLast(undefined)).toBe(false);
  expect(menu.editLast({ id: 'm2' })).toBe(true);
  expect(menu.editingId).toBe('m2');
  expect(menu.editLast({ id: 'm3' })).toBe(false);
  expect(menu.editingId).toBe('m2');
  menu.stopEditing();
  menu.edit('m3');
  expect(menu.editingId).toBe('m3');
  expect(onEdit).toHaveBeenCalledTimes(2);
});

test('replying sets the target and focuses the composer; a report opens and closes', () => {
  const { menu } = setup();
  const focus = vi.fn();
  menu.composer = { focus };

  menu.replyTo({ id: 'm1' });
  menu.report('m1');

  expect(menu.replyTarget).toEqual({ id: 'm1' });
  expect(focus).toHaveBeenCalledTimes(1);
  expect(menu.reportedId).toBe('m1');
  menu.closeReport();
  expect(menu.reportedId).toBeNull();
});

test('the menu lists the reactions the viewer already put on its message', () => {
  const { menu, reactions } = setup();
  reactions.applyServer('m1', { emoji: '👍', count: 2, reactedByMe: true, revision: '1' });
  reactions.applyServer('m1', { emoji: '🔥', count: 1, reactedByMe: false, revision: '2' });

  expect(menu.activeReactions).toEqual([]);
  rightClick(menu, { id: 'm1' }, document.createElement('span'));
  expect(menu.activeReactions).toEqual(['👍']);
});

test('the reactions of every message shown appear, including messages that arrive later', async () => {
  stubFetch({});
  const thumbs = (count: number) => [{ emoji: '👍', count, reactedByMe: false, revision: String(count) }];
  const { reactions, shown } = setup([{ id: 'm1', reactions: thumbs(1) }]);

  expect(reactions.forMessage('m1').map((item) => item.count)).toEqual([1]);
  shown.messages = [...shown.messages, { id: 'm2', reactions: thumbs(3) }];
  await nextTick();
  expect(reactions.forMessage('m2').map((item) => item.count)).toEqual([3]);
});

test('a reaction change does not show the messages again, and a disposed state stops showing', async () => {
  stubFetch({});
  const thumbs = (count: number) => [{ emoji: '👍', count, reactedByMe: false, revision: String(count) }];
  const { menu, reactions, shown } = setup([{ id: 'm1', reactions: thumbs(1) }]);
  const show = vi.spyOn(reactions, 'show');

  reactions.applyServer('m1', { emoji: '🔥', count: 1, reactedByMe: false, revision: '9' });
  await nextTick();
  expect(show).not.toHaveBeenCalled();

  menu.dispose();
  shown.messages = [...shown.messages, { id: 'm2', reactions: thumbs(3) }];
  await nextTick();
  expect(show).not.toHaveBeenCalled();
});
