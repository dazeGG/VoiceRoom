import { render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { createPinia, setActivePinia } from 'pinia';
import { expect, test } from 'vitest';
import PinnedMessagesBar from '@/features/room/components/PinnedMessagesBar.vue';
import { useRoomPinsStore } from '@/features/room/pins.store';
import type { PinnedMessage } from '@/api/pins';

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
  const pinia = createPinia();
  setActivePinia(pinia);
  const roomPins = useRoomPinsStore(pinia);
  roomPins.roomId = 'room';
  roomPins.applyRoomPinsEvent('room', { pins: [pin('m1', 'первое'), pin('m2', 'второе')] });
  render(PinnedMessagesBar, { global: { plugins: [pinia] } });

  await user.click(screen.getByRole('button', { name: /Закреплённые/ }));
  expect(screen.getByText('первое')).toBeTruthy();

  roomPins.applyRoomPinsEvent('room', { pins: [pin('m2', 'второе')] });
  expect(await screen.findByText('второе')).toBeTruthy();
  expect(screen.queryByText('первое')).toBeNull();

  roomPins.applyRoomPinsEvent('room', { pins: [] });
  await Promise.resolve();
  expect(screen.queryByRole('button', { name: /Закреплённые/ })).toBeNull();

  roomPins.applyRoomPinsEvent('room', { pins: [pin('m3', 'третье')] });
  const toggle = await screen.findByRole('button', { name: /Закреплённые/ });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByText('третье')).toBeNull();
});
