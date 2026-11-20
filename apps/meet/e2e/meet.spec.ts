import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { devices, expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    meetAudioProcessors?: () => string[];
    meetAudioEnergy?: () => Promise<number>;
    meetOpenSockets?: () => { roster: number; signal: number };
    meetDropSockets?: () => void;
  }
}

function ownerLink(): URL {
  const project = process.env.PERSONAL_SMOKE_PROJECT;
  if (!project) throw new Error('Set PERSONAL_SMOKE_PROJECT to the isolated personal Compose project');
  const link = execFileSync(
    'docker',
    [
      'compose',
      '-p',
      project,
      '-f',
      'docker-compose.personal.yml',
      'exec',
      '-T',
      'api',
      'node',
      'apps/api/src/scripts/owner-link.ts',
      '--rotate'
    ],
    { cwd: fileURLToPath(new URL('../../../', import.meta.url)), encoding: 'utf8', timeout: 30_000 }
  );
  return new URL(link.trim());
}

function installBrowserProbes(): void {
  const processors: string[] = [];
  const NativeWorkletNode = window.AudioWorkletNode;
  window.AudioWorkletNode = class extends NativeWorkletNode {
    constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
      super(context, name, options);
      processors.push(name);
    }
  };
  window.meetAudioProcessors = () => [...processors];

  const peers: RTCPeerConnection[] = [];
  const NativePeerConnection = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends NativePeerConnection {
    constructor(configuration?: RTCConfiguration) {
      super(configuration);
      peers.push(this);
    }
  };
  window.meetAudioEnergy = async () => {
    let energy = 0;
    for (const peer of peers.filter((peer) => peer.connectionState === 'connected')) {
      (await peer.getStats()).forEach((report: { type: string; kind?: string; totalAudioEnergy?: number }) => {
        if (report.type === 'inbound-rtp' && report.kind === 'audio') energy += report.totalAudioEnergy ?? 0;
      });
    }
    return energy;
  };

  const sockets: WebSocket[] = [];
  const opened = { roster: 0, signal: 0 };
  const NativeSocket = window.WebSocket;
  window.WebSocket = class extends NativeSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      const path = new URL(this.url).pathname;
      const signal = path === '/rtc' || path.startsWith('/rtc/');
      if (path !== '/api/meet/ws' && !signal) return;
      sockets.push(this);
      this.addEventListener('open', () => opened[signal ? 'signal' : 'roster']++);
    }
  };
  window.meetOpenSockets = () => ({ ...opened });
  window.meetDropSockets = () => {
    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN) socket.close(4000, 'Synthetic network drop');
    }
  };
}

function audioEnergy(page: Page): Promise<number> {
  return page.evaluate(() => window.meetAudioEnergy?.() ?? 0);
}

async function expectAudio(page: Page): Promise<void> {
  let previous = await audioEnergy(page);
  await expect
    .poll(
      async () => {
        const current = await audioEnergy(page);
        const delta = current - previous;
        previous = current;
        return delta;
      },
      { timeout: 15_000 }
    )
    .toBeGreaterThan(0.0001);
}

async function join(page: Page, link: string, name: string): Promise<void> {
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Join meeting' })).toBeVisible();
  await page.getByLabel('Display name').fill(name);
  await page.getByRole('button', { name: 'Join meeting' }).click();
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 25_000 });
  const microphone = page.locator('#muteButton');
  await expect(microphone).toBeEnabled();
  if ((await microphone.getAttribute('aria-pressed')) === 'true') await microphone.click();
  await expect(microphone).toHaveAttribute('aria-pressed', 'false');
}

test('owner shares a meeting, two guests exchange media, recover the call and leave', async ({
  page,
  browser,
  baseURL
}) => {
  const mobileContext = await browser.newContext({ ...devices['Pixel 7'], locale: 'en-US' });
  const desktopContext = await browser.newContext({ locale: 'en-US' });
  try {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const owner = ownerLink();
    expect(owner.origin).toBe(baseURL);
    await page.goto(owner.href);
    await expect(page.getByRole('heading', { name: 'Create a meeting' })).toBeVisible();
    await expect.poll(() => new URL(page.url()).hash === '').toBe(true);

    await desktopContext.addInitScript(installBrowserProbes);
    await mobileContext.addInitScript(installBrowserProbes);
    await desktopContext.addInitScript(() => {
      const media = navigator.mediaDevices;
      if (media) media.getDisplayMedia = () => media.getUserMedia({ video: true, audio: false });
    });
    const alice = await desktopContext.newPage();
    const charlie = await mobileContext.newPage();
    let leakedSignalCredential = false;
    for (const guest of [alice, charlie]) {
      guest.on('console', (message) => {
        if (/vr_gate_credential=/.test(message.text())) leakedSignalCredential = true;
      });
    }
    await page.getByRole('button', { name: 'Create meeting' }).click();
    await page.getByRole('button', { name: 'Copy link' }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('/room/');
    const link = new URL(await page.evaluate(() => navigator.clipboard.readText()));
    expect(link.origin).toBe(owner.origin);
    expect(link.pathname).toMatch(/^\/room\/[^/]+$/);
    expect(link.search + link.hash).toBe('');

    await join(alice, link.href, 'Alice');
    await join(charlie, link.href, 'Charlie');
    await expect(alice.getByText('Charlie', { exact: true })).toBeVisible();
    await expect(charlie.getByText('Alice', { exact: true })).toBeVisible();
    await Promise.all([expectAudio(alice), expectAudio(charlie)]);
    await expect.poll(() => alice.evaluate(() => window.meetAudioProcessors?.())).toContain('rnnoise');

    const camera = charlie.locator('#cameraButton');
    await camera.click();
    await expect(camera).toHaveAttribute('aria-pressed', 'true');
    await alice.bringToFront();
    const remoteCamera = alice.locator('.participant__camera');
    await expect(remoteCamera).toBeVisible();
    await expect
      .poll(() => remoteCamera.evaluate((video) => video instanceof HTMLVideoElement && video.videoWidth > 0))
      .toBe(true);
    await camera.click();
    await expect(remoteCamera).toHaveCount(0);

    const share = alice.locator('#screenButton');
    await alice.bringToFront();
    await share.click();
    await expect(share).toHaveAttribute('aria-pressed', 'true');
    await charlie.bringToFront();
    const watch = charlie.getByRole('button', { name: 'Watch screen', exact: true });
    await watch.focus();
    await watch.press('Enter');
    const screen = charlie.locator('#screenVideo');
    await expect(screen).toBeVisible();
    await expect
      .poll(() =>
        screen.evaluate((video) => video instanceof HTMLVideoElement && video.videoWidth > 0 && !video.paused)
      )
      .toBe(true);
    await share.click();
    await expect(share).toHaveAttribute('aria-pressed', 'false');
    await expect(screen).toBeHidden();

    const before = await alice.evaluate(() => window.meetOpenSockets?.());
    expect(before?.roster).toBeGreaterThan(0);
    expect(before?.signal).toBeGreaterThan(0);
    await alice.evaluate(() => window.meetDropSockets?.());
    await expect
      .poll(() => alice.evaluate(() => window.meetOpenSockets?.().roster), { timeout: 25_000 })
      .toBeGreaterThan(before?.roster ?? 0);
    await expect
      .poll(() => alice.evaluate(() => window.meetOpenSockets?.().signal), { timeout: 25_000 })
      .toBeGreaterThan(before?.signal ?? 0);
    await expect(alice.getByText('Connected', { exact: true })).toBeVisible({ timeout: 25_000 });
    await expect(charlie.getByText('Alice', { exact: true })).toHaveCount(1);
    await Promise.all([expectAudio(alice), expectAudio(charlie)]);

    await alice.locator('#leaveButton').click();
    await expect(alice.getByRole('heading', { name: 'You left the meeting' })).toBeVisible();
    await expect(charlie.getByText('Alice', { exact: true })).toHaveCount(0);
    await charlie.locator('#leaveButton').click();
    await expect(charlie.getByRole('heading', { name: 'You left the meeting' })).toBeVisible();
    expect(leakedSignalCredential).toBe(false);
  } finally {
    await Promise.all([mobileContext.close(), desktopContext.close()]);
  }
});
