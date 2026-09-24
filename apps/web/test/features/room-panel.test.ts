import { expect, test } from 'vitest';
import { freshImport } from '../helpers/fresh-module.ts';
import type * as RoomUiModule from '../../src/lib/features/room/room-ui.svelte.ts';

const load = () => freshImport<typeof RoomUiModule>('/src/lib/features/room/room-ui.svelte.ts');

test('messages that arrive while the chat is closed are counted as unread', async () => {
  const ui = await load();
  ui.incrementUnreadChat();
  ui.incrementUnreadChat();
  expect(ui.roomUi.unreadChat).toBe(2);
});

test('messages are not counted while the chat tab is open, but are on the participants tab', async () => {
  const ui = await load();
  ui.openChat();
  ui.incrementUnreadChat();
  expect(ui.roomUi.unreadChat).toBe(0);

  ui.selectRoomPanel('participants');
  ui.incrementUnreadChat();
  expect(ui.roomUi.unreadChat).toBe(1);
});

test('opening the chat tab reads everything; opening participants keeps the count', async () => {
  const ui = await load();
  ui.incrementUnreadChat();
  ui.selectRoomPanel('participants');
  expect(ui.roomUi).toMatchObject({ chatOpen: true, activePanel: 'participants', unreadChat: 1 });

  ui.selectRoomPanel('chat');
  expect(ui.roomUi).toMatchObject({ chatOpen: true, activePanel: 'chat', unreadChat: 0 });
});

test('closing the panel keeps the selected tab; toggling reopens on the chat', async () => {
  const ui = await load();
  ui.selectRoomPanel('participants');
  ui.closeChat();
  expect(ui.roomUi).toMatchObject({ chatOpen: false, activePanel: 'participants' });

  ui.incrementUnreadChat();
  ui.toggleChat();
  expect(ui.roomUi).toMatchObject({ chatOpen: true, activePanel: 'chat', unreadChat: 0 });
  ui.toggleChat();
  expect(ui.roomUi.chatOpen).toBe(false);
});
