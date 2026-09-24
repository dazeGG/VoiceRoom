// Per-person listening preferences survive reloads and follow the account,
// not the transient peer id.

import { beforeEach, expect, test } from 'vitest';
import {
  getNotificationVolumeMultiplier,
  getParticipantAudioPreference,
  getParticipantAudioPreferenceKey,
  storeParticipantAudioPreference
} from '../../src/lib/features/room/client/core/settings.ts';

beforeEach(() => localStorage.clear());

test('a signed-in person is remembered by account; a guest by peer id', () => {
  expect(getParticipantAudioPreferenceKey(' user-1 ', 'peer-9')).toBe('account:user-1');
  expect(getParticipantAudioPreferenceKey('', ' peer-9 ')).toBe('peer:peer-9');
});

test('volume and local mute are stored separately and survive a reload', () => {
  const key = 'account:user-1';
  expect(getParticipantAudioPreference(key)).toEqual({ muted: false, volume: 1 });

  storeParticipantAudioPreference(key, { volume: 1.5 });
  storeParticipantAudioPreference(key, { muted: true });
  expect(getParticipantAudioPreference(key)).toEqual({ muted: true, volume: 1.5 });

  storeParticipantAudioPreference(key, { muted: false });
  expect(getParticipantAudioPreference(key)).toEqual({ muted: false, volume: 1.5 });
  expect(JSON.parse(localStorage.getItem('voice-room:participant-audio-preferences') ?? '{}')).toEqual({ [key]: { muted: false, volume: 1.5 } });
});

test('volume is kept between 0 and 200%, and broken storage falls back to defaults', () => {
  expect(storeParticipantAudioPreference('peer:a', { volume: 7 }).volume).toBe(2);
  expect(storeParticipantAudioPreference('peer:a', { volume: -1 }).volume).toBe(0);
  expect(storeParticipantAudioPreference('peer:a', { volume: Number.NaN }).volume).toBe(1);

  localStorage.setItem('voice-room:participant-audio-preferences', '{not json');
  expect(getParticipantAudioPreference('peer:a')).toEqual({ muted: false, volume: 1 });
});

test('the interface sound volume is a stored percentage', () => {
  expect(getNotificationVolumeMultiplier()).toBe(1);
  localStorage.setItem('voice-room:notification-volume', '50');
  expect(getNotificationVolumeMultiplier()).toBe(0.5);
});
