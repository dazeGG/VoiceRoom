// Each camera layer follows the size of its tile: the stage re-picks them when the layout changes
// and also when a peer's LiveKit participant changes without the head count changing.

import { createPinia, setActivePinia } from 'pinia';
import { render, screen } from '@testing-library/vue';
import { nextTick } from 'vue';
import { beforeEach, expect, onTestFinished, test, vi } from 'vitest';
import { useCallPageStore } from '@voiceroom/call/engine/core/call-page.store';
import { useRoomDeviceUiStore } from '@voiceroom/call/engine/core/room-device-ui.store';
import { useScreenSourceUiStore } from '@voiceroom/call/engine/core/screen-source-ui.store';
import { state } from '@voiceroom/call/engine/core/room-runtime.store';
import { createInitialRoomState } from '@voiceroom/call/engine/model/room-state';
import { createParticipant } from '@voiceroom/call/engine/room/participants';
import RoomStage from '@/features/room/components/RoomStage.vue';
import { useParticipantsUiStore } from '@voiceroom/call/engine/core/participants-ui.store';
import { useAppearanceStore, DOCK_AUTOHIDE_STORAGE_KEY } from '@/shared/appearance/appearance.store';

const demand = vi.hoisted(() => ({ runs: 0, seen: '' }));

// The real function reads per-peer fields (livekitParticipant, camera state); the stand-in reads one the same way.
vi.mock('@voiceroom/call/engine/services/livekit/remote-participants', () => ({
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

function renderStage(pinia = createPinia()) {
  return render(RoomStage, {
    global: { plugins: [pinia], stubs: { RoomChat: Stub, RoomDock: Stub, ScreenStage: Stub, StageTiles: Stub } }
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

test('the room dock follows the appearance setting and stays pinned during media setup or a picker', async () => {
  const pinia = createPinia();
  useCallPageStore(pinia).screen = 'room';
  const appearance = useAppearanceStore(pinia);
  const devices = useRoomDeviceUiStore(pinia);
  const screenSource = useScreenSourceUiStore(pinia);
  renderStage(pinia);
  const autoHides = () => screen.getByRole('main').classList.contains('room-layout--dock-autohide');
  onTestFinished(() => localStorage.removeItem(DOCK_AUTOHIDE_STORAGE_KEY));

  state.joined = true;
  state.voiceConnection = 'connected';
  await nextTick();
  expect(autoHides()).toBe(false);

  appearance.setDockAutoHide(true);
  await nextTick();
  expect(autoHides()).toBe(true);

  state.voiceConnection = 'reconnecting';
  await nextTick();
  expect(autoHides()).toBe(false);
  state.voiceConnection = 'connected';

  state.joined = false;
  await nextTick();
  expect(autoHides()).toBe(false);
  state.joined = true;
  await nextTick();
  expect(autoHides()).toBe(true);

  for (const menu of ['devicePopoverOpen', 'outputPopoverOpen', 'cameraPopoverOpen'] as const) {
    devices[menu] = true;
    await nextTick();
    expect(autoHides()).toBe(false);
    devices[menu] = false;
    await nextTick();
    expect(autoHides()).toBe(true);
  }

  screenSource.open = true;
  await nextTick();
  expect(autoHides()).toBe(false);
  screenSource.open = false;
  state.screenStarting = true;
  await nextTick();
  expect(autoHides()).toBe(false);
  state.screenStarting = false;
  await nextTick();
  expect(autoHides()).toBe(true);
});
