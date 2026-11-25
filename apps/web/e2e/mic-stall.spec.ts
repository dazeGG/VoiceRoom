// A microphone that stops reaching its encoder, with the connection perfectly
// healthy, in a real browser against a real LiveKit: the sender loses its track,
// as a stall would leave it, and the listener must hear the speaker again without
// anybody leaving the call.

import { expect, test, type Browser, type Page } from '@playwright/test';
import { createPermanentRoom, enterRoom, registerViaUi, uniqueLogin } from './helpers';

declare global {
  interface Window {
    micStallProbe: {
      /**
       * Takes the microphone off its sender, leaving everything else as it was.
       * `onThisConnectionForGood` keeps taking it off, so that a rebuilt capture does not help.
       */
      stopSending(onThisConnectionForGood?: boolean): Promise<number>;
      audioPacketsReceived(): Promise<number>;
    };
  }
}

function installProbe(): void {
  const peers: RTCPeerConnection[] = [];
  const NativePeerConnection = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends NativePeerConnection {
    constructor(configuration?: RTCConfiguration) {
      super(configuration);
      peers.push(this);
    }
  };
  const live = () => peers.filter((peer) => peer.connectionState === 'connected');
  window.micStallProbe = {
    async stopSending(onThisConnectionForGood = false) {
      const connections = live();
      const stop = async () => {
        const microphones = connections
          .flatMap((peer) => peer.getSenders())
          .filter((sender) => sender.track?.kind === 'audio' && sender.track.readyState === 'live');
        await Promise.all(microphones.map((sender) => sender.replaceTrack(null)));
        if (microphones.some((sender) => sender.track !== null)) throw new Error('Microphone still attached');
        return microphones.length;
      };
      const detached = await stop();
      if (onThisConnectionForGood) setInterval(() => void stop().catch(() => {}), 100);
      return detached;
    },
    async audioPacketsReceived() {
      let packets = 0;
      for (const peer of live()) {
        (await peer.getStats()).forEach((report: { type: string; kind?: string; packetsReceived?: number }) => {
          if (report.type === 'inbound-rtp' && report.kind === 'audio') packets += report.packetsReceived ?? 0;
        });
      }
      return packets;
    }
  };
}

async function callOfTwo(browser: Browser) {
  const speakerLogin = uniqueLogin('micspeak');
  const speakerContext = await browser.newContext();
  await speakerContext.addInitScript(installProbe);
  const speaker = await speakerContext.newPage();
  const signalSockets: string[] = [];
  speaker.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname.startsWith('/rtc')) signalSockets.push(socket.url());
  });
  await registerViaUi(speaker, speakerLogin);
  const roomId = await createPermanentRoom(speaker, `Mic stall ${speakerLogin}`);
  await enterRoom(speaker, roomId);
  await expectVoice(speaker);

  const listenerContext = await browser.newContext();
  await listenerContext.addInitScript(installProbe);
  const listener = await listenerContext.newPage();
  await registerViaUi(listener, uniqueLogin('miclisten'));
  await enterRoom(listener, roomId);
  await expectVoice(listener);
  await expectToHear(listener);

  return {
    speaker,
    listener,
    signalSockets,
    close: async () => {
      await speakerContext.close();
      await listenerContext.close();
    }
  };
}

const expectVoice = (page: Page) =>
  expect(page.locator('.room-topbar__status--connected')).toContainText('Голос подключен', { timeout: 30_000 });

const packetsHeard = (listener: Page) => listener.evaluate(() => window.micStallProbe.audioPacketsReceived());

async function expectToHear(listener: Page): Promise<void> {
  const before = await packetsHeard(listener);
  await expect
    .poll(async () => (await packetsHeard(listener)) - before, { timeout: 20_000, intervals: [1000] })
    .toBeGreaterThan(50);
}

test('a stalled microphone comes back by rebuilding its capture, without leaving the call', async ({ browser }) => {
  test.setTimeout(120_000);
  const { speaker, listener, signalSockets, close } = await callOfTwo(browser);
  const socketsBefore = signalSockets.length;

  // Observe the actual loss of a live sender track. Recovery can legitimately
  // resume RTP before a fixed receiver-side silence window has finished.
  expect(await speaker.evaluate(() => window.micStallProbe.stopSending())).toBeGreaterThan(0);

  await expect(speaker.locator('#toast', { hasText: 'Микрофон переподключен' })).toBeVisible({ timeout: 40_000 });
  await expectToHear(listener);
  await expectVoice(speaker);
  expect(signalSockets.length, 'the connection was not touched').toBe(socketsBefore);
  await close();
});

test('a capture that did not help is followed by a new media connection, and the call goes on', async ({ browser }) => {
  test.setTimeout(150_000);
  const { speaker, listener, signalSockets, close } = await callOfTwo(browser);
  const socketsBefore = signalSockets.length;

  expect(await speaker.evaluate(() => window.micStallProbe.stopSending(true))).toBeGreaterThan(0);

  await expect(speaker.locator('#toast', { hasText: 'Микрофон переподключен' })).toBeVisible({ timeout: 40_000 });
  await expect.poll(() => signalSockets.length, { timeout: 60_000 }).toBeGreaterThan(socketsBefore);
  await expectToHear(listener);
  await expectVoice(speaker);
  await close();
});
