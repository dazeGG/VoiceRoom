// The server's side of the voice status: each stats poll joins its listener's
// window, the room is judged again, and only peers whose verdict changed are
// told; a listener that stopped polling or a speaker that left no longer
// counts; every stay sums its polls into minutes for the admin panel.

import test from 'node:test';
import assert from 'node:assert/strict';
import type { CpuPressure } from '@voice-room/shared/contracts/rooms';
import {
  noteMicChange,
  noteStayEvent,
  noteVoiceReport,
  refreshVoice,
  rejoinedVoice,
  VOICE_EVENTS_MAX,
  VOICE_REPORT_STALE_MS,
  type PeerVoice
} from '../src/realtime/voice-track.ts';

interface Peer {
  id: string;
  muted?: boolean | undefined;
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
const poll = (
  streams: ReturnType<typeof heard>[],
  extra: { uplinkLost?: number; rttMs?: number | null; rttUnchanged?: true } = {}
) => ({
  rttMs: extra.rttMs === undefined ? 40 : extra.rttMs,
  ...(extra.rttUnchanged ? { rttUnchanged: true as const } : {}),
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

test('a concealment event that made up no voice is not a gap, for the verdict or for the minute', () => {
  const peers = room('a', 'b');
  // WebRTC counts events for silence as well: a poll of clean speech with 30 of them, and nothing made up.
  const quiet = { peerId: 'b', packets: 150, lost: 0, concealedSamples: 0, gaps: 30 };
  for (let n = 0; n < 5; n += 1) noteVoiceReport(peers, peer(peers, 'a'), poll([quiet]), T + n * 3000);
  assert.deepEqual(peer(peers, 'a').voice?.verdict, { level: 'good', cause: null });
  assert.equal(peer(peers, 'a').voice?.minutes[0]?.heard.gaps, 0);
  assert.equal(peer(peers, 'b').voice?.minutes[0]?.heardBy.gaps ?? 0, 0);
});

test('a microphone going off or on is not a voice breaking up, on a line with nothing wrong', () => {
  const peers = room('a', 'b');
  const speaker = peer(peers, 'b');
  // As a real listener measured them. LiveKit stops forwarding a muted microphone and the receiver makes up its last moment;
  // while it stays off, the receiver reports event after event of pure silence.
  const change = { peerId: 'b', packets: 100, lost: 0, concealedSamples: 2400, gaps: 8 };
  const silence = { peerId: 'b', packets: 0, lost: 0, concealedSamples: 0, gaps: 30 };
  const good = { level: 'good', cause: null };
  noteVoiceReport(peers, peer(peers, 'a'), poll([heard('b')]), T);

  noteMicChange(speaker, T + 1000);
  noteVoiceReport(peers, peer(peers, 'a'), poll([change]), T + 3000);
  assert.deepEqual(speaker.voice?.verdict, good, 'as it went off');
  for (const at of [T + 6000, T + 9000]) {
    noteVoiceReport(peers, peer(peers, 'a'), poll([silence]), at);
    assert.deepEqual(speaker.voice?.verdict, good, 'while it stays off');
  }
  noteMicChange(speaker, T + 11_000);
  noteVoiceReport(peers, peer(peers, 'a'), poll([change]), T + 12_000);
  assert.deepEqual(speaker.voice?.verdict, good, 'as it came back');
  assert.equal(peer(peers, 'a').voice?.minutes[0]?.heard.gaps, 0, 'the minute of the one listening');
  assert.equal(speaker.voice?.minutes[0]?.heardBy.gaps, 0, 'the minute of the one speaking');
  assert.equal(speaker.voice?.minutes[0]?.heardBy.concealedSamples, 0);
});

test('every listener skips the change, whichever polls first', () => {
  const peers = room('a', 'b', 'c');
  const change = { peerId: 'b', packets: 150, lost: 0, concealedSamples: 2400, gaps: 8 };
  noteMicChange(peer(peers, 'b'), T);
  noteVoiceReport(peers, peer(peers, 'a'), poll([change]), T + 500);
  noteVoiceReport(peers, peer(peers, 'c'), poll([change]), T + 2900);
  assert.equal(peer(peers, 'b').voice?.minutes[0]?.heardBy.gaps ?? 0, 0);
});

test('the first poll wholly after a microphone came back counts: only the change is skipped', () => {
  const peers = room('a', 'b');
  noteMicChange(peer(peers, 'b'), T);
  noteVoiceReport(peers, peer(peers, 'a'), poll([heard('b', 25)]), T + 1000);
  assert.equal(peer(peers, 'b').voice?.minutes[0]?.heardBy.concealedSamples ?? 0, 0, 'this poll holds the change');
  noteVoiceReport(peers, peer(peers, 'a'), poll([heard('b', 25)]), T + 4000);
  assert.equal(peer(peers, 'b').voice?.minutes[0]?.heardBy.concealedSamples, 36_000, 'this one does not');
  assert.deepEqual(peer(peers, 'a').voice?.verdict, { level: 'bad', cause: 'hears_badly' });
});

test('a muted flag left over from before a reconnect does not hide a voice breaking up', () => {
  const peers = room('a', 'b');
  peer(peers, 'b').muted = true;
  noteVoiceReport(peers, peer(peers, 'a'), poll([heard('b', 25)]), T);
  assert.deepEqual(peer(peers, 'a').voice?.verdict, { level: 'bad', cause: 'hears_badly' });
});

test('a long buffer of someone who says little still counts toward a delay', () => {
  const peers = room('a', 'b');
  const buffered = (buffer: number | null) => ({ ...poll([heard('b')]), jitterBufferMs: buffer, rttMs: 200 });
  noteVoiceReport(peers, peer(peers, 'b'), poll([heard('a')], { rttMs: 200 }), T);
  noteVoiceReport(peers, peer(peers, 'b'), poll([heard('a')], { rttMs: 200 }), T + 3000);
  noteVoiceReport(peers, peer(peers, 'b'), poll([heard('a')], { rttMs: 200 }), T + 6000);
  noteVoiceReport(peers, peer(peers, 'a'), buffered(null), T + 6100);
  noteVoiceReport(peers, peer(peers, 'a'), buffered(null), T + 6200);
  assert.deepEqual(peer(peers, 'a').voice?.verdict, { level: 'good', cause: null });
  noteVoiceReport(peers, peer(peers, 'a'), buffered(300), T + 6300);
  assert.deepEqual(
    peer(peers, 'a').voice?.verdict,
    { level: 'unstable', cause: 'delay' },
    'one reading, 200 + 300 + 40'
  );
});

test("a stay's minute keeps its speaker's worst window, which summing over everyone would water down", () => {
  const peers = room('a', 'b', 'c');
  noteVoiceReport(peers, peer(peers, 'a'), poll([heard('b', 10), heard('c')]), T);
  noteVoiceReport(peers, peer(peers, 'a'), poll([heard('b'), heard('c')]), T + 3000);
  const minute = peer(peers, 'a').voice?.minutes[0];
  assert.deepEqual(minute?.worstHeard, { concealedPct: 10, gaps: 6 }, 'b alone, over its first window');
  assert.deepEqual(peer(peers, 'b').voice?.minutes[0]?.worstHeardBy, { concealedPct: 10, gaps: 6 });
  assert.equal(peer(peers, 'c').voice?.minutes[0]?.worstHeardBy?.concealedPct, 0);
});

test('a minute counts why its polls were not good', () => {
  const peers = room('a', 'b');
  noteVoiceReport(peers, peer(peers, 'b'), poll([heard('a')]), T);
  noteVoiceReport(peers, peer(peers, 'a'), poll([heard('b')]), T + 100);
  assert.equal(peer(peers, 'a').voice?.minutes[0]?.causes, undefined, 'nothing to say of a good poll');
  noteVoiceReport(peers, peer(peers, 'a'), poll([heard('b', 25)]), T + 3000);
  noteVoiceReport(peers, peer(peers, 'a'), poll([heard('b', 25)]), T + 6000);
  assert.deepEqual(peer(peers, 'a').voice?.minutes[0]?.causes, { heard_badly: 0, hears_badly: 2, delay: 0 });
});

test('a delay is read from most of the latest polls, so one spike of the round trip is not a long delay', () => {
  const peers = room('a', 'b');
  const verdictOfA = () => peer(peers, 'a').voice?.verdict;
  let at = T;
  const round = (rttMs: number) => {
    noteVoiceReport(peers, peer(peers, 'b'), poll([heard('a')]), at);
    noteVoiceReport(peers, peer(peers, 'a'), poll([heard('b')], { rttMs }), at + 100);
    at += 3000;
  };
  for (const rttMs of [40, 40, 900, 40, 40]) {
    round(rttMs);
    assert.deepEqual(verdictOfA(), { level: 'good', cause: null }, `${rttMs} ms`);
  }
  round(900);
  assert.deepEqual(verdictOfA(), { level: 'good', cause: null }, 'two of the latest five');
  round(900);
  assert.deepEqual(verdictOfA(), { level: 'unstable', cause: 'delay' }, 'three high receipts fit the wider window');
  round(40);
  assert.deepEqual(verdictOfA(), { level: 'good', cause: null }, 'the oldest high receipt falls out of the window');
});

test('the first polls of a call say nothing of its delay', () => {
  const peers = room('a', 'b');
  noteVoiceReport(peers, peer(peers, 'b'), poll([heard('a')]), T);
  noteVoiceReport(peers, peer(peers, 'a'), poll([heard('b')], { rttMs: 900 }), T + 100);
  noteVoiceReport(peers, peer(peers, 'b'), poll([heard('a')]), T + 3000);
  noteVoiceReport(peers, peer(peers, 'a'), poll([heard('b')], { rttMs: 900 }), T + 3100);
  assert.deepEqual(peer(peers, 'a').voice?.verdict, { level: 'good', cause: null }, 'two polls measured');
  noteVoiceReport(peers, peer(peers, 'b'), poll([heard('a')]), T + 6000);
  noteVoiceReport(peers, peer(peers, 'a'), poll([heard('b')], { rttMs: 900 }), T + 6100);
  assert.deepEqual(peer(peers, 'a').voice?.verdict, { level: 'unstable', cause: 'delay' }, 'three polls measured');
});

test('RTT receipts settle from three, null clears, and exact age limits exclude stale samples', () => {
  const peers = room('a', 'b');
  const send = (id: string, rttMs: number | null, at: number) =>
    noteVoiceReport(peers, peer(peers, id), poll([heard(id === 'a' ? 'b' : 'a')], { rttMs }), at);
  for (const at of [T + 1000, T + 4000, T + 7000]) send('a', 1000, at);
  for (const at of [T + 1000, T + 4000, T + 7000]) send('b', 40, at + 100);
  assert.equal(peer(peers, 'a').voice?.verdict?.cause, 'delay');
  send('a', null, T + 12_900);
  send('b', 40, T + 18_800);
  assert.notEqual(peer(peers, 'a').voice?.verdict?.cause, 'delay');
  assert.equal(peer(peers, 'a').voice?.rttPolls.length, 0);
});

test('sparse RTCP receipts settle across unchanged polls without counting them as samples', () => {
  const peers = room('a', 'b');
  const send = (id: string, at: number, rttMs: number | null, rttUnchanged = false) =>
    noteVoiceReport(
      peers,
      peer(peers, id),
      poll([heard(id === 'a' ? 'b' : 'a')], { rttMs, ...(rttUnchanged ? { rttUnchanged: true } : {}) }),
      T + at
    );
  for (const at of [0, 6000, 12_000]) {
    send('a', at, 1000);
    send('b', at, 40);
    const counted = peer(peers, 'a').voice?.minutes.reduce((sum, minute) => sum + minute.rttPolls, 0);
    send('a', at + 3000, null, true);
    send('b', at + 3000, null, true);
    assert.equal(
      peer(peers, 'a').voice?.minutes.reduce((sum, minute) => sum + minute.rttPolls, 0),
      counted
    );
  }
  assert.deepEqual(
    peer(peers, 'a').voice?.rttPolls.map((sample) => sample.at - T),
    [0, 6000, 12_000]
  );
  assert.equal(peer(peers, 'a').voice?.verdict?.cause, 'delay');
  send('a', 20_999, null, true);
  assert.equal(peer(peers, 'a').voice?.rttPolls.length, 2, 'old samples still expire on unchanged polls');
  send('a', 21_000, null, true);
  assert.equal(peer(peers, 'a').voice?.rttPolls.length, 0, 'unchanged reports do not extend last real receipt');
  send('a', 24_000, 900, true);
  assert.deepEqual(
    peer(peers, 'a').voice?.rttPolls.map((sample) => sample.value),
    [900],
    'numeric still counts when marked'
  );
});

test('RTT sample age 20s and last-receipt age 9s have distinct exact boundaries', () => {
  const peers = room('a', 'b');
  for (const at of [1000, 8000, 15_000]) {
    noteVoiceReport(peers, peer(peers, 'a'), poll([heard('b')], { rttMs: 1000 }), T + at);
    noteVoiceReport(peers, peer(peers, 'b'), poll([heard('a')], { rttMs: 40 }), T + at);
  }
  refreshVoice(peers, T + 20_999);
  assert.equal(peer(peers, 'a').voice?.verdict?.cause, 'delay');
  refreshVoice(peers, T + 21_000);
  assert.notEqual(peer(peers, 'a').voice?.verdict?.cause, 'delay');
  assert.equal(peer(peers, 'a').voice?.rttPolls.length, 2);
  refreshVoice(peers, T + 24_000);
  assert.equal(peer(peers, 'a').voice?.rttPolls.length, 0);

  const clustered = room('a', 'b');
  for (const at of [7000, 7500, 8000]) {
    noteVoiceReport(clustered, peer(clustered, 'a'), poll([heard('b')], { rttMs: 1000 }), T + at);
    noteVoiceReport(clustered, peer(clustered, 'b'), poll([heard('a')], { rttMs: 40 }), T + at);
  }
  refreshVoice(clustered, T + 16_999);
  assert.equal(peer(clustered, 'a').voice?.verdict?.cause, 'delay');
  refreshVoice(clustered, T + 17_000);
  assert.equal(peer(clustered, 'a').voice?.rttPolls.length, 0);
  assert.notEqual(peer(clustered, 'a').voice?.verdict?.cause, 'delay');
});

test('null and rejoin require three new RTT receipts before delay can return', () => {
  const peers = room('a', 'b');
  const send = (at: number, value: number | null) => {
    noteVoiceReport(peers, peer(peers, 'a'), poll([heard('b')], { rttMs: value }), T + at);
    noteVoiceReport(peers, peer(peers, 'b'), poll([heard('a')], { rttMs: 40 }), T + at);
  };
  for (const at of [0, 3300, 6600]) send(at, 1000);
  assert.equal(peer(peers, 'a').voice?.verdict?.cause, 'delay');
  send(9000, null);
  assert.notEqual(peer(peers, 'a').voice?.verdict?.cause, 'delay');
  send(9900, 1000);
  send(12_900, 1000);
  assert.notEqual(peer(peers, 'a').voice?.verdict?.cause, 'delay');
  send(15_900, 1000);
  assert.equal(peer(peers, 'a').voice?.verdict?.cause, 'delay');
  const freshSeat = rejoinedVoice(peer(peers, 'a').voice);
  peers.set('a', { id: 'a', voice: freshSeat });
  assert.equal(freshSeat?.rttPolls.length, 0);
});

test('a minute sums how the microphone reached its encoder, and a poll without it adds nothing', () => {
  const peers = room('a', 'b');
  const mic = { expectedMs: 3000, deliveredMs: 1000, contextMs: 2900, reopens: 1, replacements: 0 };
  noteVoiceReport(peers, peer(peers, 'a'), { ...poll([heard('b')]), mic }, T);
  noteVoiceReport(
    peers,
    peer(peers, 'a'),
    { ...poll([heard('b')]), mic: { ...mic, reopens: 0, replacements: 1 } },
    T + 3000
  );
  noteVoiceReport(peers, peer(peers, 'a'), poll([heard('b')]), T + 6000);

  assert.deepEqual(peer(peers, 'a').voice?.minutes[0]?.mic, {
    expectedMs: 6000,
    deliveredMs: 2000,
    contextMs: 5800,
    reopens: 1,
    replacements: 1
  });
  noteVoiceReport(peers, peer(peers, 'b'), poll([heard('a')]), T);
  assert.deepEqual(peer(peers, 'b').voice?.minutes[0]?.mic, {
    expectedMs: 0,
    deliveredMs: 0,
    contextMs: 0,
    reopens: 0,
    replacements: 0
  });
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

test('a minute sums what the computer reported, and an overload and its relief are kept once each', () => {
  const peers = room('a', 'b');
  const cpu = (
    pressure: CpuPressure | null,
    relieved = false,
    appPct: number | null = 10,
    systemPct: number | null = 80
  ) => ({
    appPct,
    systemPct,
    pressure,
    relieved
  });
  noteVoiceReport(peers, peer(peers, 'a'), { ...poll([heard('b')]), cpu: cpu('fair') }, T);
  noteVoiceReport(peers, peer(peers, 'a'), { ...poll([heard('b')]), cpu: cpu('critical') }, T + 3000);
  noteVoiceReport(peers, peer(peers, 'a'), { ...poll([heard('b')]), cpu: cpu('critical', true, null, null) }, T + 6000);
  noteVoiceReport(peers, peer(peers, 'a'), { ...poll([heard('b')]), cpu: cpu('fair', true) }, T + 9000);
  noteVoiceReport(peers, peer(peers, 'a'), { ...poll([heard('b')]), cpu: cpu('critical', true) }, T + 12_000);
  noteVoiceReport(peers, peer(peers, 'a'), poll([heard('b')]), T + 15_000);

  const voice = peer(peers, 'a').voice;
  assert.deepEqual(voice?.minutes[0]?.cpu, {
    appPctSum: 40,
    systemPctSum: 320,
    polls: 4,
    pressureMax: 'critical',
    relieved: true
  });
  assert.deepEqual(voice?.events, [
    { at: T + 3000, kind: 'cpu_critical' },
    { at: T + 6000, kind: 'relieved_ns' },
    { at: T + 12_000, kind: 'cpu_critical' }
  ]);
  assert.equal(voice?.cpuPressure, 'critical', 'a poll that says nothing leaves what was last said');
  assert.equal(peer(peers, 'b').voice?.minutes[0]?.cpu, undefined, 'nothing was said of b');
  assert.deepEqual(rejoinedVoice(voice)?.events, voice?.events, 'a rejoined seat keeps them');
});

test('a stay keeps only its latest events', () => {
  const peers = room('a');
  const seat = peer(peers, 'a');
  for (let n = 0; n <= VOICE_EVENTS_MAX; n += 1) noteStayEvent(seat, 'screen_on', T + n);
  assert.equal(seat.voice?.events.length, VOICE_EVENTS_MAX);
  assert.equal(seat.voice?.events[0]?.at, T + 1);
});
