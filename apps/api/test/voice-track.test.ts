// The server's side of the voice status: each stats poll joins its listener's
// window, the room is judged again, and only peers whose verdict changed are
// told; a listener that stopped polling or a speaker that left no longer
// counts; every stay sums its polls into minutes for the admin panel.

import test from 'node:test';
import assert from 'node:assert/strict';
import { noteVoiceReport, rejoinedVoice, VOICE_REPORT_STALE_MS, type PeerVoice } from '../src/realtime/voice-track.ts';

interface Peer {
  id: string;
  voice?: PeerVoice | undefined;
}

const room = (...ids: string[]) => new Map<string, Peer>(ids.map((id) => [id, { id }]));
const peer = (peers: Map<string, Peer>, id: string) => {
  const found = peers.get(id);
  assert.ok(found, id);
  return found;
};

/** Three seconds of one speaker's continuous speech, `concealedPct` of it made up in 50 ms gaps. */
const heard = (peerId: string, concealedPct = 0, lost = 0) => {
  const concealedSamples = Math.round((150 * 960 * concealedPct) / 100);
  return { peerId, packets: 150, lost, concealedSamples, gaps: Math.round(concealedSamples / 2400) };
};
const poll = (streams: ReturnType<typeof heard>[], extra: { uplinkLost?: number; rttMs?: number | null } = {}) => ({
  rttMs: extra.rttMs === undefined ? 40 : extra.rttMs,
  jitterBufferMs: 30,
  uplink: { packets: 150, lost: extra.uplinkLost ?? 0 },
  transport: 'udp' as const,
  heard: streams
});
const told = (changes: { peer: Peer; verdict: unknown }[]) =>
  Object.fromEntries(changes.map(({ peer, verdict }) => [peer.id, verdict]));

const T = Date.UTC(2026, 9, 31, 12, 0, 10);

test('a peer is told its verdict when it changes, and only then', () => {
  const peers = room('a', 'b', 'c');
  assert.deepEqual(told(noteVoiceReport(peers, peer(peers, 'a'), poll([heard('b'), heard('c')]), T)), {
    a: { level: 'good', cause: null },
    b: { level: 'good', cause: null },
    c: { level: 'good', cause: null }
  });
  assert.deepEqual(told(noteVoiceReport(peers, peer(peers, 'b'), poll([heard('a'), heard('c')]), T + 100)), {});
  // c breaks up for a alone: what a hears. Then for b too: c is the one heard badly, and a hears fine.
  assert.deepEqual(told(noteVoiceReport(peers, peer(peers, 'a'), poll([heard('b'), heard('c', 25)]), T + 3000)), {
    a: { level: 'bad', cause: 'hears_badly' }
  });
  assert.deepEqual(told(noteVoiceReport(peers, peer(peers, 'b'), poll([heard('a'), heard('c', 25)]), T + 3100)), {
    a: { level: 'good', cause: null },
    c: { level: 'bad', cause: 'heard_badly' }
  });
  assert.equal(peer(peers, 'c').voice?.verdict?.level, 'bad', 'the verdict the admin panel shows');
});

test('a listener that stopped polling and a speaker that left no longer count', () => {
  const peers = room('a', 'b');
  noteVoiceReport(peers, peer(peers, 'b'), poll([heard('a')]), T);
  noteVoiceReport(peers, peer(peers, 'a'), poll([heard('b', 25, 40)]), T);
  assert.equal(peer(peers, 'a').voice?.verdict?.level, 'bad', 'a hears b break up, and b lost nothing on its way up');

  // a's tab went to the background: its last poll is stale by the time b polls again.
  assert.deepEqual(told(noteVoiceReport(peers, peer(peers, 'b'), poll([heard('a')]), T + VOICE_REPORT_STALE_MS + 1)), {
    a: { level: 'good', cause: null }
  });

  peers.delete('b');
  noteVoiceReport(peers, peer(peers, 'a'), poll([heard('b', 25)]), T + VOICE_REPORT_STALE_MS + 2);
  assert.equal(peer(peers, 'a').voice?.heard.size, 0, 'a speaker who left is not kept');
  assert.equal(peer(peers, 'a').voice?.verdict, null, 'alone, nothing was heard');
});

test('a speaker gone quiet leaves the window after five polls', () => {
  const peers = room('a', 'b');
  noteVoiceReport(peers, peer(peers, 'a'), poll([heard('b', 25)]), T);
  for (let n = 1; n < 5; n += 1) noteVoiceReport(peers, peer(peers, 'a'), poll([]), T + n * 3000);
  assert.equal(peer(peers, 'a').voice?.heard.get('b')?.length, 5);
  noteVoiceReport(peers, peer(peers, 'a'), poll([]), T + 15_000);
  assert.equal(peer(peers, 'a').voice?.heard.has('b'), false);
});

test("a stay's minutes sum its polls, what it heard and what its listeners heard of it", () => {
  const peers = room('a', 'b');
  // b's own uplink lost as much as a heard missing: b is the one heard badly.
  noteVoiceReport(peers, peer(peers, 'b'), poll([heard('a')], { uplinkLost: 40 }), T);
  noteVoiceReport(peers, peer(peers, 'a'), poll([heard('b', 25, 40)], { rttMs: null }), T + 1000);
  noteVoiceReport(peers, peer(peers, 'a'), poll([heard('b', 25, 40)], { rttMs: 60 }), T + 4000);
  // The next minute starts a new row, for what its listener heard of it too.
  noteVoiceReport(peers, peer(peers, 'a'), poll([heard('b', 25, 40)]), T + 59_000);
  noteVoiceReport(peers, peer(peers, 'b'), poll([heard('a')], { uplinkLost: 40 }), T + 60_000);

  const [first, second] = peer(peers, 'b').voice?.minutes ?? [];
  assert.equal(first?.at, Date.UTC(2026, 9, 31, 12, 0));
  assert.deepEqual(first?.polls, { good: 1, unstable: 0, bad: 0 });
  assert.deepEqual(first?.heard, { packets: 150, lost: 0, concealedSamples: 0, gaps: 0 });
  assert.deepEqual(first?.heardBy, { packets: 300, lost: 80, concealedSamples: 72_000, gaps: 30 });
  assert.deepEqual(first?.uplink, { packets: 150, lost: 40 });
  assert.equal(second?.at, Date.UTC(2026, 9, 31, 12, 1));
  assert.deepEqual(second?.heardBy, { packets: 150, lost: 40, concealedSamples: 36_000, gaps: 15 });
  assert.deepEqual(second?.polls, { good: 0, unstable: 0, bad: 1 }, 'b hears a fine but is heard badly');

  const minute = peer(peers, 'a').voice?.minutes[0];
  assert.deepEqual([minute?.rttMsSum, minute?.rttPolls], [60, 1], 'a poll without a round trip is not averaged in');
  assert.deepEqual(minute?.polls, { good: 2, unstable: 0, bad: 0 });
});

test('a rejoined seat keeps its minutes and is told its verdict afresh', () => {
  const peers = room('a', 'b');
  noteVoiceReport(peers, peer(peers, 'a'), poll([heard('b')]), T);
  const voice = rejoinedVoice(peer(peers, 'a').voice);
  peers.set('a', { id: 'a', voice });
  assert.equal(voice?.minutes.length, 1);
  assert.deepEqual(told(noteVoiceReport(peers, peer(peers, 'b'), poll([heard('a')]), T + 100)), {
    a: { level: 'good', cause: null }
  });
});
