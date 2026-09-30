import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { flushSync } from 'svelte';
import { afterEach, expect, test } from 'vitest';
import PinnedMessagesBar from '../../src/lib/features/room/components/PinnedMessagesBar.svelte';
import { applyRoomPinsEvent, resetRoomPins, roomPins } from '../../src/lib/features/room/pins.svelte';
import type { PinnedMessage } from '../../src/lib/api/pins';

afterEach(() => {
  cleanup();
  resetRoomPins();
});

function pin(messageId: string, text: string): PinnedMessage {
  return {
    messageId,
    pinnedBy: 'ada',
    pinnedByName: 'Ада',
    pinnedAt: 1,
    author: { peerId: 'p', userId: 'ada', name: 'Ада' },
    text,
    content: null,
    createdAt: 1
  };
}

test('the strip folds back when the last pin goes, and a new pin shows as a count again', async () => {
  const user = userEvent.setup();
  roomPins.roomId = 'room';
  applyRoomPinsEvent('room', { pins: [pin('m1', 'первое'), pin('m2', 'второе')] });
  render(PinnedMessagesBar, { props: { onJump: () => {}, onUnpin: () => {} } });

  await user.click(screen.getByRole('button', { name: /Закреплённые/ }));
  expect(screen.getByText('первое')).toBeTruthy();

  applyRoomPinsEvent('room', { pins: [pin('m2', 'второе')] });
  flushSync();
  expect(screen.getByText('второе')).toBeTruthy();
  expect(screen.queryByText('первое')).toBeNull();

  applyRoomPinsEvent('room', { pins: [] });
  flushSync();
  expect(screen.queryByRole('button', { name: /Закреплённые/ })).toBeNull();

  applyRoomPinsEvent('room', { pins: [pin('m3', 'третье')] });
  flushSync();
  expect(screen.getByRole('button', { name: /Закреплённые/ }).getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByText('третье')).toBeNull();
});
