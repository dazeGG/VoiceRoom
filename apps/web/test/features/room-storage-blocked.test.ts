// A browser that blocks site storage (privacy mode, disabled cookies) throws
// as soon as the page touches `localStorage`. The room must still start, with
// the defaults, instead of failing while it builds its state.

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, expect, onTestFinished, test } from 'vitest';
import { useRoomMembershipStore } from '@/entities/room/room-membership.store';
import { persistMasterVolume } from '@/features/room/client/core/settings';
import { state } from '@/features/room/client/core/room-runtime.store';
import { createInitialRoomState } from '@/features/room/client/model/room-state';
import { switchMicrophone, switchOutputDevice, updateGateThresholdFromSlider } from '@/features/room/client/ui/devices';
import { useRoomDeviceUiStore } from '@/features/room/room-device-ui.store';
import { clearAttachmentComposeStores } from '@/shared/chat/attachment-compose-stores';
import { AttachmentComposeStore } from '@/shared/chat/attachment-compose';
import { stubFetch } from '../fixtures/fetch';

beforeEach(() => setActivePinia(createPinia()));

function blockLocalStorage(): void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    }
  });
  onTestFinished(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  });
}

test('blocked localStorage still builds the room client state with the defaults', () => {
  blockLocalStorage();

  expect(createInitialRoomState()).toMatchObject({
    cameraDeviceId: '',
    microphoneDeviceId: '',
    outputDeviceId: '',
    outputMuted: false,
    serverConnection: 'idle',
    voiceConnection: 'idle'
  });
});

test('blocked localStorage does not break saving a setting', () => {
  blockLocalStorage();

  expect(persistMasterVolume(40)).toBe(40);
});

test('blocked localStorage does not break picking a microphone, a speaker or the gate level', async () => {
  blockLocalStorage();
  Object.assign(state, createInitialRoomState());
  useRoomDeviceUiStore().microphoneId = 'usb-mic';

  await expect(switchMicrophone()).resolves.toBe(false);
  expect(state.microphoneDeviceId).toBe('usb-mic');
  // jsdom has no setSinkId, so the speaker choice falls back to the system one.
  await expect(switchOutputDevice()).resolves.toBeUndefined();
  expect(state.outputDeviceId).toBe('');
  updateGateThresholdFromSlider(-42);
  expect(state.gateThresholdDb).toBe(-42);
});

test('blocked localStorage does not break the room chat attachments or leaving the room', async () => {
  blockLocalStorage();
  stubFetch({ 'DELETE /api/rooms/room-blocked/memberships/me': { body: { ok: true, left: true } } });

  expect(new AttachmentComposeStore('room', 'room-blocked').drafts).toEqual([]);
  expect(() => clearAttachmentComposeStores()).not.toThrow();
  await expect(useRoomMembershipStore().leaveActiveRoomMembership('room-blocked')).resolves.toBe(true);
});
