// Participants and their speaking rings, driven through the room client's
// public functions with a fake audio analyser.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { state } from '../../src/lib/features/room/client/core/state.svelte.ts';
import { createInitialRoomState } from '../../src/lib/features/room/client/model/room-state.ts';
import {
  clearAllSpeaking,
  createParticipant,
  detachLiveKitParticipant,
  syncPeers,
  updatePeerStatus
} from '../../src/lib/features/room/client/room/participants.ts';
import { METER_INTERVAL_MS, startMeters, stopMeters } from '../../src/lib/features/room/client/media/meters.ts';
import type { Participant } from '../../src/lib/features/room/client/core/types.ts';
import type { MeterAnalyser } from '../../src/lib/features/room/client/model/participants.ts';
import { defined } from '../helpers/assert.ts';
import { FakeMediaStream, FakeMediaStreamTrack } from '../helpers/fake-media.ts';

beforeEach(() => {
  Object.assign(state, createInitialRoomState());
  state.peerId = 'me';
  vi.useFakeTimers();
});

afterEach(() => {
  stopMeters();
  vi.useRealTimers();
});

/** An analyser whose samples swing by `amplitude` around silence (0..127). */
function analyser(amplitude: number): MeterAnalyser {
  return {
    frequencyBinCount: 64,
    getByteTimeDomainData(data) {
      data.forEach((_, index) => {
        data[index] = 128 + (index % 2 === 0 ? amplitude : -amplitude);
      });
    }
  };
}

function withAnalyser(participant: Participant, amplitude: number): Participant {
  participant.analyser = analyser(amplitude);
  participant.meterData = new Uint8Array(64);
  return participant;
}

function runFrame(): void {
  vi.advanceTimersByTime(METER_INTERVAL_MS);
}

test('a peer that leaves LiveKit stops its voice element and lets go of the stream', () => {
  const peer = createParticipant({ id: 'peer-a', name: 'A' });
  const audio = document.createElement('audio');
  audio.srcObject = new FakeMediaStream([new FakeMediaStreamTrack('voice', 'audio')]);
  const pause = vi.spyOn(audio, 'pause').mockImplementation(() => {});
  document.body.append(audio);
  peer.audioElements.set('voice', audio);

  detachLiveKitParticipant(peer);

  expect(pause).toHaveBeenCalled();
  expect(audio.srcObject).toBeNull();
  expect(audio.isConnected).toBe(false);
  expect(peer.audioElements.size).toBe(0);
});

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
  expect([loud, quiet, muted].every((participant) => !('level' in participant))).toBe(true);
});

test('the rings are read on a fixed timer, not every display frame', () => {
  withAnalyser(createParticipant({ id: 'loud', name: 'Громкий' }), 60);
  let readings = 0;
  const peer = defined(state.peers.get('loud'), 'the loud peer');
  const original = defined(peer.analyser, "the loud peer's analyser");
  peer.analyser = {
    frequencyBinCount: original.frequencyBinCount,
    getByteTimeDomainData(data) {
      readings += 1;
      original.getByteTimeDomainData(data);
    }
  };

  startMeters();
  startMeters();
  vi.advanceTimersByTime(1000);
  expect(readings).toBe(Math.floor(1000 / METER_INTERVAL_MS));

  stopMeters();
  vi.advanceTimersByTime(1000);
  expect(readings).toBe(Math.floor(1000 / METER_INTERVAL_MS));
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

test('a remote tile shows no placeholder while its voice connects, only a real voice problem', () => {
  const peer = createParticipant({ id: 'peer-a', name: 'A' });
  expect(peer.statusLabel).toBe('');

  detachLiveKitParticipant(peer);
  updatePeerStatus(peer);
  expect(peer.statusLabel).toBe('');

  peer.voiceIssue = 'голос не подключен';
  updatePeerStatus(peer);
  expect(peer.statusLabel).toBe('голос не подключен');

  const self = createParticipant({ id: 'me', name: 'Я' });
  self.voiceIssue = 'голос не подключен';
  updatePeerStatus(self);
  expect(self.statusLabel).toBe('');
});
