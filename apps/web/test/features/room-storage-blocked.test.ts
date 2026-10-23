// A browser that blocks site storage (privacy mode, disabled cookies) throws
// as soon as the page touches `localStorage`. The room must still start, with
// the defaults, instead of failing while it builds its state.

import { expect, onTestFinished, test } from 'vitest';
import { leaveActiveRoomMembership } from '../../src/lib/entities/room/room-membership.svelte.ts';
import { persistMasterVolume } from '../../src/lib/features/room/client/core/settings.ts';
import { state } from '../../src/lib/features/room/client/core/state.svelte.ts';
import { createInitialRoomState } from '../../src/lib/features/room/client/model/room-state.ts';
import {
  switchMicrophone,
  switchOutputDevice,
  updateGateThresholdFromSlider
} from '../../src/lib/features/room/client/ui/devices.ts';
import { roomDeviceUi } from '../../src/lib/features/room/room-device-ui.svelte.ts';
import { clearAttachmentComposeStores } from '../../src/lib/shared/chat/attachment-compose-stores.ts';
import { AttachmentComposeStore } from '../../src/lib/shared/chat/attachment-compose.svelte.ts';
import { stubFetch } from '../fixtures/fetch.ts';

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
  roomDeviceUi.microphoneId = 'usb-mic';

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
  await expect(leaveActiveRoomMembership('room-blocked')).resolves.toBe(true);
});
