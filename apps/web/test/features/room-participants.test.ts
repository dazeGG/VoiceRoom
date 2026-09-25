// Participants and their speaking rings, driven through the room client's
// public functions with a fake audio analyser.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { state } from '../../src/lib/features/room/client/core/state.svelte.ts';
import { createInitialRoomState } from '../../src/lib/features/room/client/model/room-state.ts';
import {
  clearAllSpeaking,
  createParticipant,
  syncPeers
} from '../../src/lib/features/room/client/room/participants.ts';
import { startMeters, stopMeters } from '../../src/lib/features/room/client/media/meters.ts';
import type { Participant } from '../../src/lib/features/room/client/core/types.ts';

let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  Object.assign(state, createInitialRoomState());
  state.peerId = 'me';
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => stopMeters());

/** An analyser whose samples swing by `amplitude` around silence (0..127). */
function analyser(amplitude: number) {
  return {
    frequencyBinCount: 64,
    getByteTimeDomainData(data: Uint8Array) {
      data.forEach((_, index) => {
        data[index] = 128 + (index % 2 === 0 ? amplitude : -amplitude);
      });
    }
  } as unknown as AnalyserNode;
}

function withAnalyser(participant: Participant, amplitude: number): Participant {
  participant.analyser = analyser(amplitude);
  participant.meterData = new Uint8Array(64);
  return participant;
}

function runFrame(): void {
  const pending = frames;
  frames = [];
  for (const frame of pending) frame(performance.now());
}

test('the local participant is the self tile, even when a copy of it was listed as a peer', () => {
  const self = createParticipant({ id: 'me', name: 'Анна' });
  expect(state.self?.id).toBe('me');
  expect(state.self?.isLocal).toBe(true);
  expect(state.peers.has('me')).toBe(false);

  state.peers.set('me', { ...self, isLocal: false });
  createParticipant({ id: 'me', name: 'Анна', muted: true });
  expect(state.self?.id).toBe('me');
  expect(state.self?.muted).toBe(true);
  expect(state.peers.has('me')).toBe(false);
});

test('peers missing from the roster are removed', () => {
  createParticipant({ id: 'peer-a', name: 'A' });
  createParticipant({ id: 'peer-b', name: 'B' });
  syncPeers(['peer-b']);
  expect([...state.peers.keys()]).toEqual(['peer-b']);
});

test('a remote voice above the speaking level lights its ring, silence and a muted peer do not', () => {
  const loud = withAnalyser(createParticipant({ id: 'loud', name: 'Громкий' }), 60);
  const quiet = withAnalyser(createParticipant({ id: 'quiet', name: 'Тихий' }), 0);
  const muted = withAnalyser(createParticipant({ id: 'muted', name: 'Без звука', muted: true }), 60);

  startMeters();
  runFrame();

  expect(state.peers.get('loud')?.speaking).toBe(true);
  expect(state.peers.get('quiet')?.speaking).toBe(false);
  expect(state.peers.get('muted')?.speaking).toBe(false);
  expect(loud.level).toBeGreaterThan(0);
  expect(muted.level).toBe(0);
  expect(quiet.level).toBe(0);
});

test('while deafened no ring claims someone is audible', () => {
  withAnalyser(createParticipant({ id: 'loud', name: 'Громкий' }), 60);
  state.outputMuted = true;
  startMeters();
  runFrame();
  expect(state.peers.get('loud')?.speaking).toBe(false);
});

test('clearing speaking turns every ring off at once', () => {
  withAnalyser(createParticipant({ id: 'loud', name: 'Громкий' }), 60);
  startMeters();
  runFrame();
  expect(state.peers.get('loud')?.speaking).toBe(true);
  clearAllSpeaking();
  expect(state.peers.get('loud')?.speaking).toBe(false);
});
