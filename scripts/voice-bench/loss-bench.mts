// The loss bench behind the voice status thresholds (packages/shared
// voice-quality.ts): how much made-up speech a listener measures at each loss
// on the line, next to how a person rated what they heard.
//
// Start the dev stack (npm run dev:up), open a room at http://127.0.0.1:5180,
// join it and mute your microphone, then:
//   node scripts/voice-bench/loss-bench.mts <roomId>
//
// Two guest bots join: one speaks a looped recording (SPEECH_WAV, or speech
// synthesized with Windows SAPI), the other stays silent and measures what it
// receives. Each step sets loss, bursts or jitter on everything LiveKit sends
// (tc netem on its UDP media port, from a sidecar in its network namespace),
// so you hear the same line as the measuring bot. The steps run in a random
// order and are named only after you rate them. Results go to stdout and to a
// JSON file (RESULTS).
//
// Settings: BASE_URL (http://127.0.0.1:5180), LIVEKIT_CONTAINER
// (voiceroom-livekit-1), STEP_SECONDS (30), ORDER=fixed, HEADED=1, SET=harsh
// (heavy loss and long bursts, for where speech stops getting through).

import { spawnSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { chromium, type Browser, type Page } from '@playwright/test';
import { isRecord } from '@voice-room/shared/guards';
import { VOICE_SAMPLES_PER_PACKET, concealedSpeechPct, streamLevel } from '@voice-room/shared/voice-quality';

const roomId = process.argv[2];
if (!roomId) throw new Error('usage: node scripts/voice-bench/loss-bench.mts <roomId>');
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:5180';
const livekit = process.env.LIVEKIT_CONTAINER || 'voiceroom-livekit-1';
const stepMs = Number(process.env.STEP_SECONDS || 30) * 1000;
const results = process.env.RESULTS || join(tmpdir(), `voice-bench-${Date.now()}.json`);
const sidecar = 'voice-bench-netem';
/** The first seconds after a change are the jitter buffer settling, not the line. */
const SETTLE_MS = 5000;

// Gilbert-Elliott bursts: from a good state lose with p, stay lost with 1 - r,
// so the mean loss is p / (p + r) and a burst lasts 1 / r packets: about 3
// packets (60 ms) at r = 30 %, about 10 (200 ms) at r = 10 %.
const burst = (meanPct: number, r = 30) => `loss gemodel ${((meanPct * r) / (100 - meanPct)).toFixed(2)}% ${r}%`;
interface Step {
  label: string;
  netem: string | null;
}
const randomLoss = (pct: number): Step => ({ label: `случайные потери ${pct}%`, netem: `loss ${pct}%` });
const bursts = (pct: number): Step => ({ label: `потери пачками ~${pct}%`, netem: burst(pct) });
const longBursts = (pct: number): Step => ({ label: `длинные пачки по ~200 мс, ~${pct}%`, netem: burst(pct, 10) });
/** Always first: what the room sounds like before anything is done to the line. */
const CLEAN_STEP: Step = { label: 'чистая линия', netem: null };
// SET=harsh looks for where speech stops getting through; random 20 % repeats a step of the default set.
const LINE_STEPS: Step[] =
  process.env.SET === 'harsh'
    ? [...[20, 40, 50, 60].map(randomLoss), ...[30, 40].map(bursts), ...[10, 20].map(longBursts)]
    : [
        ...[1, 3, 5, 10, 15, 20, 30].map(randomLoss),
        ...[3, 10, 20].map(bursts),
        { label: 'джиттер 50 мс', netem: 'delay 50ms 30ms distribution normal' },
        { label: 'джиттер 100 мс', netem: 'delay 100ms 60ms distribution normal' }
      ];

function run(command: string, args: string[], env?: NodeJS.ProcessEnv): string {
  const result = spawnSync(command, args, { encoding: 'utf8', env: { ...process.env, ...env } });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')}: ${result.stderr || result.stdout}`);
  return result.stdout;
}

const netem = (script: string) => run('docker', ['exec', sidecar, 'sh', '-c', script]);

function startNetem(): void {
  spawnSync('docker', ['rm', '-f', sidecar], { encoding: 'utf8' });
  run('docker', [
    'run',
    '-d',
    '--name',
    sidecar,
    '--net',
    `container:${livekit}`,
    '--cap-add',
    'NET_ADMIN',
    'alpine:3.20',
    'sleep',
    '86400'
  ]);
  netem('apk add -q iproute2');
  // Only LiveKit's UDP media goes through the netem band; signalling stays clean.
  netem(
    [
      'tc qdisc add dev eth0 root handle 1: prio',
      'tc qdisc add dev eth0 parent 1:3 handle 30: netem delay 0ms',
      'tc filter add dev eth0 protocol ip parent 1:0 prio 1 u32 match ip protocol 17 0xff match ip sport 7882 0xffff flowid 1:3'
    ].join(' && ')
  );
}

const setLine = (rule: string | null) =>
  netem(`tc qdisc change dev eth0 parent 1:3 handle 30: netem ${rule ?? 'delay 0ms'}`);

function stopNetem(): void {
  spawnSync('docker', ['exec', sidecar, 'tc', 'qdisc', 'del', 'dev', 'eth0', 'root'], { encoding: 'utf8' });
  spawnSync('docker', ['rm', '-f', sidecar], { encoding: 'utf8' });
}

/** A 16-bit mono 48 kHz WAV of silence, for the bot that only listens. */
function silentWav(path: string): void {
  const seconds = 10;
  const data = Buffer.alloc(48_000 * 2 * seconds);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(48_000, 24);
  header.writeUInt32LE(96_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([header, data]));
}

const SPEECH_TEXT = [
  'The quick brown fox jumps over the lazy dog, and the dog does not seem to mind at all.',
  'We are testing how a voice call sounds when the network drops some of its packets.',
  'Listen for clicks, robotic tones, missing syllables and words that break apart.',
  'One, two, three, four, five, six, seven, eight, nine, ten.',
  'She sells sea shells by the sea shore, and the shells she sells are surely sea shells.'
].join(' ');

function speechWav(path: string): void {
  run(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      [
        'Add-Type -AssemblyName System.Speech',
        '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
        '$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(48000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)',
        '$s.SetOutputToWaveFile($env:BENCH_WAV, $f)',
        '$s.Speak($env:BENCH_TEXT)',
        '$s.Dispose()'
      ].join('; ')
    ],
    { BENCH_WAV: path, BENCH_TEXT: SPEECH_TEXT }
  );
}

// Every peer connection the page opens, so the bench can read its stats.
const CAPTURE_CONNECTIONS = `(() => {
  const Native = window.RTCPeerConnection;
  window.__benchConnections = [];
  window.RTCPeerConnection = class extends Native {
    constructor(...args) { super(...args); window.__benchConnections.push(this); }
  };
})();`;

async function joinAsGuest(browser: Browser, name: string, capture: boolean): Promise<Page> {
  const context = await browser.newContext({ baseURL: baseUrl });
  if (capture) await context.addInitScript(CAPTURE_CONNECTIONS);
  const page = await context.newPage();
  await page.goto(`/r/${roomId}`);
  await page.locator('#guestNameInput').fill(name, { timeout: 20_000 });
  await page.locator('#guestNameSubmitButton').click();
  await page.locator('.room-topbar__status--connected').waitFor({ state: 'attached', timeout: 30_000 });
  return page;
}

function launch(wav: string): Promise<Browser> {
  return chromium.launch({
    headless: process.env.HEADED !== '1',
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${wav}`,
      '--autoplay-policy=no-user-gesture-required'
    ]
  });
}

interface Received {
  codec: string;
  packets: number;
  lost: number;
  concealed: number;
  concealmentEvents: number;
  jitterBufferSeconds: number;
  emitted: number;
}

/** The incoming audio stream that carried the most packets: the speaking bot, with your microphone muted. */
async function readReceived(page: Page): Promise<Received | null> {
  const stats: unknown[] = await page.evaluate(async () => {
    // Runs in the page, so it cannot import a guard; Array.isArray alone would make the items `any`.
    const isList = (value: unknown): value is unknown[] => Array.isArray(value);
    const connections: unknown = Reflect.get(window, '__benchConnections');
    const all: unknown[] = [];
    if (!isList(connections)) return all;
    for (const connection of connections) {
      if (!(connection instanceof RTCPeerConnection) || connection.connectionState === 'closed') continue;
      (await connection.getStats()).forEach((stat: unknown) => all.push(stat));
    }
    return all;
  });
  const records = stats.filter(isRecord);
  const num = (stat: Record<string, unknown>, key: string) => (typeof stat[key] === 'number' ? stat[key] : 0);
  let best: Received | null = null;
  for (const stat of records) {
    if (stat.type !== 'inbound-rtp' || stat.kind !== 'audio') continue;
    const codec = records.find((other) => other.id === stat.codecId)?.mimeType;
    const lost = Math.max(0, num(stat, 'packetsLost'));
    const reading: Received = {
      codec: typeof codec === 'string' ? codec : '',
      packets: num(stat, 'packetsReceived') + lost,
      lost,
      concealed: num(stat, 'concealedSamples') - num(stat, 'silentConcealedSamples'),
      concealmentEvents: num(stat, 'concealmentEvents'),
      jitterBufferSeconds: num(stat, 'jitterBufferDelay'),
      emitted: num(stat, 'jitterBufferEmittedCount')
    };
    if (!best || reading.packets > best.packets) best = reading;
  }
  return best;
}

const delta = (after: Received, before: Received) => ({
  codec: after.codec,
  packets: after.packets - before.packets,
  // Reordered and duplicated packets take back losses counted earlier.
  lost: Math.max(0, after.lost - before.lost),
  concealed: after.concealed - before.concealed,
  concealmentEvents: after.concealmentEvents - before.concealmentEvents,
  jitterBufferMs:
    after.emitted > before.emitted
      ? Math.round(((after.jitterBufferSeconds - before.jitterBufferSeconds) / (after.emitted - before.emitted)) * 1000)
      : null
});

const RATINGS: Record<string, string> = { '1': 'чисто', '2': 'помехи', '3': 'почти не слышно' };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const speech = process.env.SPEECH_WAV || join(tmpdir(), 'voice-bench-speech.wav');
  if (!existsSync(speech)) speechWav(speech);
  const silence = join(tmpdir(), 'voice-bench-silence.wav');
  silentWav(silence);

  const steps = [CLEAN_STEP, ...(process.env.ORDER === 'fixed' ? LINE_STEPS : shuffle(LINE_STEPS))];
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const browsers: Browser[] = [];
  const rows: object[] = [];
  const cleanup = () => {
    stopNetem();
    void Promise.all(browsers.map((browser) => browser.close()));
  };
  process.once('SIGINT', () => {
    cleanup();
    process.exit(130);
  });

  try {
    startNetem();
    const speaker = await launch(speech);
    browsers.push(speaker);
    const hearer = await launch(silence);
    browsers.push(hearer);
    await joinAsGuest(speaker, 'Бот-говорящий', false);
    const listener = await joinAsGuest(hearer, 'Бот-слушатель', true);
    console.log('Боты в комнате. Выключи свой микрофон и слушай «Бот-говорящий».\n');

    for (const [index, step] of steps.entries()) {
      setLine(step.netem);
      console.log(`Шаг ${index + 1}/${steps.length}: слушай ${stepMs / 1000} с…`);
      await wait(SETTLE_MS);
      const before = await readReceived(listener);
      await wait(stepMs - SETTLE_MS);
      const after = await readReceived(listener);
      setLine(null);
      // Without a terminal the bench only measures.
      const answer = process.stdin.isTTY
        ? (await prompt.question('  Как было? 1 чисто, 2 помехи, 3 почти не слышно, Enter — пропустить: ')).trim()
        : '';
      if (!before || !after) {
        console.log(`  ${step.label}: слушатель не получил звук\n`);
        continue;
      }
      const measured = delta(after, before);
      const heard = {
        packets: measured.packets,
        lost: measured.lost,
        concealedSamples: measured.concealed,
        gaps: measured.concealmentEvents
      };
      const concealedPct = concealedSpeechPct(heard);
      const row = {
        step: step.label,
        netem: step.netem,
        rating: RATINGS[answer] ?? null,
        codec: measured.codec,
        lossPct: measured.packets > 0 ? Math.round((measured.lost / measured.packets) * 1000) / 10 : null,
        concealedPct,
        // Per minute of speech, as the packets measure it, so pauses do not water it down.
        gapsPerSpeechMin:
          measured.packets > 0
            ? Math.round(measured.concealmentEvents / ((measured.packets * VOICE_SAMPLES_PER_PACKET) / 48_000 / 60))
            : null,
        jitterBufferMs: measured.jitterBufferMs,
        // The whole step as one window, its latest poll included.
        level: streamLevel({ latest: heard, window: heard })
      };
      rows.push(row);
      console.log(
        `  ${row.step}: оценка «${row.rating ?? '—'}», потери ${row.lossPct}%, сокрыто ${row.concealedPct}%,` +
          ` ${row.gapsPerSpeechMin} дыр/мин речи, буфер ${row.jitterBufferMs} мс, модель: ${row.level} (${row.codec})\n`
      );
      writeFileSync(results, JSON.stringify(rows, null, 2));
    }
    console.table(rows);
    console.log(`Результаты: ${results}`);
  } finally {
    prompt.close();
    cleanup();
  }
}

function shuffle<T>(items: readonly T[]): T[] {
  return items
    .map((item) => ({ item, key: Math.random() }))
    .sort((a, b) => a.key - b.key)
    .map(({ item }) => item);
}

await main();
