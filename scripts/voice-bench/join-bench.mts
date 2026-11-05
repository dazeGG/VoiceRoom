// How long joining a call takes, stage by stage, as a real browser sees it:
// from the click on the guest name form to the first sound of the other peer.
// Nothing in the app is changed for it: the page's own browser APIs are wrapped,
// so the same bench measures any build.
//
//   BASE_URL=https://voiceroom.internal node scripts/voice-bench/join-bench.mts <roomId>
//
// A second bot stays in the room and makes sound, so "first sound" means a
// subscription really happened. Network delay is not faked here: run this in a
// container whose line is shaped with tc netem (docs/PERFORMANCE.md).
//
// Settings: BASE_URL, RUNS (5), LABEL (shown in the results), CPU_SLOWDOWN (1),
// THINK_MS (2000, the pause on the form before the click),
// RESULTS (a JSON file to write), WARM_ONLY=1 (skip the empty-cache runs),
// TRUST_SPKI (key hashes of a test stand's certificates), FLOW=account (a
// signed-in user entering from the lobby; registers an account and makes the
// room itself, so <roomId> is ignored).

import { writeFileSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';

const roomId = process.argv[2] ?? '';
if (!roomId) throw new Error('usage: node scripts/voice-bench/join-bench.mts <roomId>');
const baseUrl = process.env.BASE_URL || 'https://voiceroom.internal';
const runs = Number(process.env.RUNS || 5);
const label = process.env.LABEL || 'run';
const cpuSlowdown = Number(process.env.CPU_SLOWDOWN || 1);
const PASSWORD = 'bench-password-123';
/** How long a person looks at the form before the click that joins. */
const thinkMs = Number(process.env.THINK_MS || 2000);

// Stages a join goes through, in the order the table prints them.
const STAGES = [
  'roomCheckSent',
  'roomCheck',
  'microphoneAsked',
  'microphone',
  'workletsFirst',
  'worklets',
  'tokenSent',
  'token',
  'signalSent',
  'signalOpen',
  'peerConnected',
  'statusConnected',
  'firstPacketSent',
  'firstSoundHeard'
] as const;
type Stage = (typeof STAGES)[number];
type StageTimes = Partial<Record<Stage, number>>;

// Runs in the page before any of its code. Times are milliseconds after the click.
const PROBE = String.raw`(() => {
  const marks = {};
  let clickAt = null;
  const now = () => (clickAt === null ? null : Math.round(performance.now() - clickAt));
  const mark = (name) => { const at = now(); if (at !== null && marks[name] === undefined) marks[name] = at; };
  const last = (name) => { const at = now(); if (at !== null) marks[name] = at; };
  window.__joinMarks = marks;
  window.__joinStart = () => { clickAt = performance.now(); };

  const fetchNative = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const url = String(args[0] && args[0].url ? args[0].url : args[0]);
    const isToken = url.includes('/api/livekit-token');
    const isRoomCheck = /\/api\/rooms\/[^/]+$/.test(new URL(url, location.href).pathname);
    if (isToken) mark('tokenSent');
    if (isRoomCheck) mark('roomCheckSent');
    const response = await fetchNative(...args);
    if (isToken) mark('token');
    if (isRoomCheck) mark('roomCheck');
    return response;
  };

  const media = navigator.mediaDevices;
  const gumNative = media.getUserMedia.bind(media);
  media.getUserMedia = async (...args) => {
    if (args[0] && args[0].audio) mark('microphoneAsked');
    const stream = await gumNative(...args);
    if (args[0] && args[0].audio) mark('microphone');
    return stream;
  };

  const addModule = AudioWorklet.prototype.addModule;
  AudioWorklet.prototype.addModule = async function (...args) {
    mark('workletsFirst');
    const result = await addModule.apply(this, args);
    last('worklets');
    return result;
  };

  const SocketNative = window.WebSocket;
  window.WebSocket = class extends SocketNative {
    constructor(...args) {
      super(...args);
      if (new URL(String(args[0])).pathname.startsWith('/rtc')) {
        mark('signalSent');
        this.addEventListener('open', () => mark('signalOpen'));
      }
    }
  };

  const connections = [];
  const PeerNative = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends PeerNative {
    constructor(...args) {
      super(...args);
      connections.push(this);
      this.addEventListener('connectionstatechange', () => {
        if (this.connectionState === 'connected') mark('peerConnected');
      });
    }
  };

  setInterval(async () => {
    if (clickAt === null) return;
    if (!marks.statusConnected && document.querySelector('.room-topbar__status--connected')) mark('statusConnected');
    if (marks.firstPacketSent && marks.firstSoundHeard) return;
    for (const connection of connections) {
      if (connection.connectionState === 'closed') continue;
      const stats = await connection.getStats();
      stats.forEach((stat) => {
        if (stat.kind !== 'audio') return;
        if (stat.type === 'outbound-rtp' && stat.packetsSent > 0) mark('firstPacketSent');
        if (stat.type === 'inbound-rtp' && stat.packetsReceived > 0) mark('firstSoundHeard');
      });
    }
  }, 25);
})();`;

function launch(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      // A self-signed test stand: trusted by key, because Chromium does not cache over a certificate error.
      ...(process.env.TRUST_SPKI ? [`--ignore-certificate-errors-spki-list=${process.env.TRUST_SPKI}`] : [])
    ]
  });
}

async function fillGuestName(page: Page, name: string): Promise<void> {
  await page.locator('#guestNameInput').fill(name, { timeout: 60_000 });
}

async function startBot(browser: Browser, room: string): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: baseUrl });
  const page = await context.newPage();
  await page.goto(`/r/${room}`);
  await fillGuestName(page, 'Бот-собеседник');
  await page.locator('#guestNameSubmitButton').click();
  await page.locator('.room-topbar__status--connected').waitFor({ state: 'attached', timeout: 60_000 });
  return context;
}

interface PageLoad {
  requests: number;
  /** Files the browser asked the server about, including an answer of "not modified". */
  hitTheNetwork: number;
  fromNetworkBytes: number;
  firstContentfulPaint: number | null;
  formVisibleMs: number;
}

interface JoinRun {
  stages: StageTimes;
  load: PageLoad;
}

/** A new account with a permanent room of its own, in a context that stays signed in. */
async function signIn(browser: Browser): Promise<{ context: BrowserContext; room: string }> {
  const context = await browser.newContext({ baseURL: baseUrl });
  await context.addInitScript(PROBE);
  const page = await context.newPage();
  const login = `bench${Date.now().toString(36)}`;
  await page.goto('/register');
  const dialog = page.getByRole('dialog', { name: 'Создать аккаунт' });
  await dialog.getByLabel('Логин').fill(login, { timeout: 60_000 });
  await dialog.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
  await dialog.getByLabel('Повторите пароль').fill(PASSWORD);
  await Promise.all([
    page.waitForURL((url) => url.pathname === '/', { timeout: 60_000 }),
    dialog.getByRole('button', { name: 'Создать аккаунт', exact: true }).click()
  ]);
  await page.getByRole('button', { name: 'Создать комнату' }).waitFor({ timeout: 60_000 });
  // From the page, so it carries the session cookie and trusts what the browser trusts.
  const answer: unknown = await page.evaluate(async () => {
    const created = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bench', isStatic: true })
    });
    return created.json();
  });
  const room: unknown = Reflect.get(Object(answer), 'roomId');
  if (typeof room !== 'string') throw new Error(`no room: ${JSON.stringify(answer)}`);
  await page.close();
  return { context, room };
}

/** Opens the page, starts the clock on the click that joins, and waits for the first sound. */
async function measureJoin(
  context: BrowserContext,
  path: string,
  join: { prepare: (page: Page) => Promise<void>; click: (page: Page) => Promise<void> }
): Promise<JoinRun> {
  const page = await context.newPage();
  if (cpuSlowdown > 1) {
    const session = await context.newCDPSession(page);
    await session.send('Emulation.setCPUThrottlingRate', { rate: cpuSlowdown });
  }
  let requests = 0;
  page.on('response', () => {
    requests += 1;
  });

  const openedAt = Date.now();
  await page.goto(path, { waitUntil: 'commit' });
  await join.prepare(page);
  const formVisibleMs = Date.now() - openedAt;
  const loaded = await page.evaluate(() => {
    const paint = performance.getEntriesByName('first-contentful-paint')[0];
    const navigation = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource');
    const entries = navigation ? [navigation, ...resources] : resources;
    let bytes = 0;
    let hits = 0;
    for (const entry of entries) {
      if (!(entry instanceof PerformanceResourceTiming)) continue;
      bytes += entry.transferSize;
      if (entry.transferSize > 0) hits += 1;
    }
    return { paint: paint ? Math.round(paint.startTime) : null, bytes, hits };
  });

  await page.waitForTimeout(thinkMs);
  await page.evaluate(() => Reflect.get(window, '__joinStart')());
  await join.click(page);
  await page.waitForFunction(
    () => {
      const marks: unknown = Reflect.get(window, '__joinMarks');
      return Boolean(
        marks && Reflect.get(Object(marks), 'firstSoundHeard') && Reflect.get(Object(marks), 'statusConnected')
      );
    },
    undefined,
    { timeout: 60_000 }
  );
  const stages = await page.evaluate((): StageTimes => {
    const marks: unknown = Reflect.get(window, '__joinMarks');
    return Object.fromEntries(Object.entries(Object(marks)).filter(([, at]) => typeof at === 'number'));
  });
  await page.close();
  return {
    stages,
    load: {
      requests,
      hitTheNetwork: loaded.hits,
      fromNetworkBytes: loaded.bytes,
      firstContentfulPaint: loaded.paint,
      formVisibleMs
    }
  };
}

const asGuest = (name: string) => ({
  prepare: (page: Page) => fillGuestName(page, name),
  click: (page: Page) => page.locator('#guestNameSubmitButton').click()
});

const fromLobby = {
  prepare: async (page: Page) => {
    await page.locator('.voice-home__card', { hasText: 'Bench' }).first().click({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Войти в комнату' }).waitFor({ timeout: 60_000 });
  },
  click: (page: Page) => page.getByRole('button', { name: 'Войти в комнату' }).click()
};

const median = (values: number[]): number | null => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted[Math.floor(sorted.length / 2)];
  return middle === undefined ? null : middle;
};

function summarize(title: string, samples: JoinRun[]): object {
  const stages = Object.fromEntries(
    STAGES.map((stage) => [
      stage,
      median(samples.flatMap((sample) => (sample.stages[stage] === undefined ? [] : [sample.stages[stage]])))
    ])
  );
  const load = {
    requests: median(samples.map((sample) => sample.load.requests)),
    hitTheNetwork: median(samples.map((sample) => sample.load.hitTheNetwork)),
    fromNetworkKb: Math.round((median(samples.map((sample) => sample.load.fromNetworkBytes)) ?? 0) / 1024),
    firstContentfulPaint: median(samples.flatMap((sample) => sample.load.firstContentfulPaint ?? [])),
    formVisibleMs: median(samples.map((sample) => sample.load.formVisibleMs))
  };
  console.log(`\n${label}, ${title} (median of ${samples.length})`);
  console.log(`  page: ${JSON.stringify(load)}`);
  for (const stage of STAGES) console.log(`  ${stage.padEnd(17)} ${String(stages[stage] ?? '-').padStart(6)} ms`);
  return { title, runs: samples.length, load, stages, raw: samples };
}

async function main(): Promise<void> {
  const browser = await launch();
  const results: object[] = [];
  try {
    if (process.env.FLOW === 'account') {
      const { context, room } = await signIn(browser);
      const bot = await startBot(browser, room);
      await measureJoin(context, '/', fromLobby);
      const signedIn: JoinRun[] = [];
      for (let run = 0; run < runs; run += 1) signedIn.push(await measureJoin(context, '/', fromLobby));
      results.push(summarize('signed in, from the lobby', signedIn));
      await bot.close();
      await context.close();
      return;
    }

    const bot = await startBot(browser, roomId);

    if (process.env.WARM_ONLY !== '1') {
      const cold: JoinRun[] = [];
      for (let run = 0; run < runs; run += 1) {
        const context = await browser.newContext({ baseURL: baseUrl });
        await context.addInitScript(PROBE);
        cold.push(await measureJoin(context, `/r/${roomId}`, asGuest(`Холодный ${run}`)));
        await context.close();
      }
      results.push(summarize('empty cache', cold));
    }

    const context = await browser.newContext({ baseURL: baseUrl });
    await context.addInitScript(PROBE);
    await measureJoin(context, `/r/${roomId}`, asGuest('Прогрев'));
    const warm: JoinRun[] = [];
    for (let run = 0; run < runs; run += 1)
      warm.push(await measureJoin(context, `/r/${roomId}`, asGuest(`Повторный ${run}`)));
    results.push(summarize('warm cache', warm));
    await context.close();
    await bot.close();
  } finally {
    await browser.close();
    if (process.env.RESULTS) {
      writeFileSync(process.env.RESULTS, JSON.stringify({ label, cpuSlowdown, results }, null, 2));
    }
  }
}

await main();
