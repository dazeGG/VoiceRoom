import { fireEvent, render, screen } from '@testing-library/vue';
import { createPinia } from 'pinia';
import { expect, test, vi } from 'vitest';
import { state } from '@voiceroom/call/engine/core/room-runtime.store';
import { createInitialRoomState } from '@voiceroom/call/engine/model/room-state';
import StageTiles from '@/features/room/components/StageTiles.vue';
import { participant } from '../fixtures/participant';

test('my tile leads the grid and carousel while a focused peer takes the spotlight', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    }
  );
  Object.assign(state, createInitialRoomState());
  state.self = participant({ id: 'me', name: 'Анна', isLocal: true, joinedAt: 3 });
  state.peers.set('late', participant({ id: 'late', name: 'Борис', joinedAt: 2 }));
  state.peers.set('early', participant({ id: 'early', name: 'Вера', joinedAt: 1, screen: true }));
  const { container } = render(StageTiles, { global: { plugins: [createPinia()] } });
  const tileOrder = (selector: string) =>
    [...container.querySelectorAll(`${selector} > [data-peer-id]`)].map((tile) => [
      tile.getAttribute('data-peer-id'),
      tile.classList.contains('stream-tile') ? 'stream' : 'participant'
    ]);

  expect(tileOrder('#tileGrid')).toEqual([
    ['me', 'participant'],
    ['early', 'stream'],
    ['early', 'participant'],
    ['late', 'participant']
  ]);

  await fireEvent.click(screen.getByRole('button', { name: /^Борис\./ }));

  expect(tileOrder('.participant-focus__stage')).toEqual([['late', 'participant']]);
  expect(tileOrder('.participant-carousel__strip')).toEqual([
    ['me', 'participant'],
    ['early', 'stream'],
    ['early', 'participant']
  ]);
});
