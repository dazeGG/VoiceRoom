// Each camera layer follows the size of its tile: the stage re-picks them when the layout changes
// and also when a peer's LiveKit participant changes without the head count changing.

import { createPinia, setActivePinia } from 'pinia';
import { render } from '@testing-library/vue';
import { nextTick } from 'vue';
import { beforeEach, expect, test, vi } from 'vitest';
import { state } from '@voice-room/call/engine/core/room-runtime.store';
import { createInitialRoomState } from '@voice-room/call/engine/model/room-state';
import { createParticipant } from '@voice-room/call/engine/room/participants';
import RoomStage from '@/features/room/components/RoomStage.vue';
import { useParticipantsUiStore } from '@voice-room/call/engine/core/participants-ui.store';

const demand = vi.hoisted(() => ({ runs: 0, seen: '' }));

// The real function reads per-peer fields (livekitParticipant, camera state); the stand-in reads one the same way.
vi.mock('@voice-room/call/engine/services/livekit/remote-participants', () => ({
  syncRemoteCameraDemand: () => {
    demand.runs += 1;
    for (const peer of state.peers.values()) demand.seen = peer.statusLabel;
  }
}));

const Stub = { template: '<div></div>' };

beforeEach(() => {
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
  demand.runs = 0;
});

function renderStage() {
  return render(RoomStage, {
    global: { plugins: [createPinia()], stubs: { RoomChat: Stub, RoomDock: Stub, ScreenStage: Stub, StageTiles: Stub } }
  });
}

test('the camera layers are re-picked on mount and when the spotlight changes', async () => {
  createParticipant({ id: 'anna', name: 'Анна' });
  renderStage();
  const afterMount = demand.runs;
  expect(afterMount).toBeGreaterThan(0);

  useParticipantsUiStore().toggleParticipantFocus('anna');
  await nextTick();
  expect(demand.runs).toBeGreaterThan(afterMount);
});

test('they are re-picked when a field of a peer it reads changes without the head count changing', async () => {
  const anna = createParticipant({ id: 'anna', name: 'Анна' });
  renderStage();
  const afterMount = demand.runs;

  anna.statusLabel = 'x';
  await nextTick();
  expect(demand.runs).toBeGreaterThan(afterMount);
});
