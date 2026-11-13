// A second peer observes the actual RTP audio energy after a microphone graph
// replacement. Fake Chromium media is synthetic and contains no private speech.
import { expect, test, type Page } from '@playwright/test';
import { getLiveKitMicrophoneMuted } from './livekit-publication-probe';
import { createPermanentRoom, enterRoom, registerViaUi, uniqueLogin } from './helpers';

declare global {
  interface Window {
    receivedAudioEnergy?: () => Promise<number>;
    audioSenderTrackId?: () => string;
    endPreparedMicrophone?: () => number;
    endCurrentMicrophone?: () => number;
    failNextMicrophoneAndEndCurrent?: () => boolean;
    microphoneFailures?: () => number;
  }
}

function installPeerProbe(): void {
  const peers: RTCPeerConnection[] = [];
  const NativePeerConnection = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends NativePeerConnection {
    constructor(configuration?: RTCConfiguration) {
      super(configuration);
      peers.push(this);
    }
  };
  window.receivedAudioEnergy = async () => {
    let energy = 0;
    for (const peer of peers.filter((candidate) => candidate.connectionState === 'connected')) {
      (await peer.getStats()).forEach((report: { type: string; kind?: string; totalAudioEnergy?: number }) => {
        if (report.type === 'inbound-rtp' && report.kind === 'audio') energy += report.totalAudioEnergy ?? 0;
      });
    }
    return energy;
  };
  window.audioSenderTrackId = () =>
    peers
      .filter((candidate) => candidate.connectionState === 'connected')
      .flatMap((peer) => peer.getSenders())
      .find((sender) => sender.track?.kind === 'audio')?.track?.id ?? '';
}

async function energyDelta(page: Page, durationMs = 2500): Promise<number> {
  const before = await page.evaluate(() => window.receivedAudioEnergy?.() ?? 0);
  await page.waitForTimeout(durationMs);
  return (await page.evaluate(() => window.receivedAudioEnergy?.() ?? 0)) - before;
}

function installCaptureFailureProbe(): void {
  const media = navigator.mediaDevices;
  if (!media) return;
  const getUserMedia = media.getUserMedia.bind(media);
  const tracks: MediaStreamTrack[] = [];
  let failNext = false;
  let failures = 0;
  const endTracks = (notify: boolean): number => {
    const live = tracks.filter((track) => track.readyState === 'live');
    for (const track of live) {
      track.stop();
      if (notify) track.dispatchEvent(new Event('ended'));
    }
    return live.length;
  };
  media.getUserMedia = async (constraints) => {
    if (failNext) {
      failNext = false;
      failures += 1;
      endTracks(true);
      await new Promise((resolve) => window.setTimeout(resolve, 150));
      throw new DOMException('Synthetic microphone acquisition failure', 'NotReadableError');
    }
    const stream = await getUserMedia(constraints);
    tracks.push(...stream.getAudioTracks());
    return stream;
  };
  window.endPreparedMicrophone = () => endTracks(false);
  window.endCurrentMicrophone = () => endTracks(true);
  window.failNextMicrophoneAndEndCurrent = () => {
    failNext = true;
    return tracks.some((track) => track.readyState === 'live');
  };
  window.microphoneFailures = () => failures;
}

test('PTT idle stays silent with an unmuted publication through graph replacement, then keydown is audible', async ({
  browser
}) => {
  test.setTimeout(120_000);
  const speakerContext = await browser.newContext();
  const listenerContext = await browser.newContext();
  await speakerContext.addInitScript(installPeerProbe);
  await listenerContext.addInitScript(installPeerProbe);
  await speakerContext.addInitScript(() => {
    // Chromium simulates only the desktop capability gate; no native hotkey bridge.
    window.voiceRoomRuntime = { isDesktop: true, platform: 'win32', version: 'e2e' };
    try {
      localStorage.setItem('voice-room:microphone-mode', 'push-to-talk');
      localStorage.setItem(
        'voice-room:hotkey:push-to-talk',
        JSON.stringify({ altKey: false, code: 'KeyV', ctrlKey: false, metaKey: false, shiftKey: false })
      );
    } catch {
      // The initial about:blank document may not have storage; the app origin does.
    }
  });
  try {
    const speaker = await speakerContext.newPage();
    const listener = await listenerContext.newPage();
    const login = uniqueLogin('pttspeaker');
    await registerViaUi(speaker, login);
    const roomId = await createPermanentRoom(speaker, `PTT replacement ${login}`);
    await enterRoom(speaker, roomId);
    await expect(speaker.locator('.room-topbar__status--connected')).toContainText('Голос подключен', {
      timeout: 30_000
    });
    await registerViaUi(listener, uniqueLogin('pttlistener'));
    await enterRoom(listener, roomId);
    await expect(listener.locator('.room-topbar__status--connected')).toContainText('Голос подключен', {
      timeout: 30_000
    });
    const originalTrack = await speaker.evaluate(() => window.audioSenderTrackId?.() ?? '');
    expect(originalTrack).not.toBe('');
    const mic = speaker.locator('.room-dock__button--mic');
    await expect(mic).toHaveAttribute('aria-label', 'Push-to-talk: микрофон закрыт');
    await expect.poll(() => getLiveKitMicrophoneMuted(`voice-room-${roomId}`, login), { timeout: 15_000 }).toBe(false);
    await listener.waitForTimeout(2000); // Drain RTP already in flight before measuring idle energy.
    expect(await energyDelta(listener, 3000)).toBeLessThan(0.0001);

    await speaker.getByRole('button', { name: 'Выбрать микрофон' }).click();
    await speaker.getByRole('combobox', { name: 'Шумоподавление' }).click();
    await speaker.getByRole('option', { name: 'Браузерный' }).click();
    await expect(speaker.getByRole('combobox', { name: 'Шумоподавление' })).toContainText('Браузерный');
    await expect
      .poll(() => speaker.evaluate(() => window.audioSenderTrackId?.() ?? ''), { timeout: 15_000 })
      .not.toBe(originalTrack);
    await expect.poll(() => getLiveKitMicrophoneMuted(`voice-room-${roomId}`, login), { timeout: 15_000 }).toBe(false);
    await listener.waitForTimeout(2000);
    expect(await energyDelta(listener, 3000)).toBeLessThan(0.0001);

    await speaker.keyboard.down('v');
    await expect(mic).toHaveAttribute('aria-label', 'Push-to-talk: микрофон открыт');
    await expect.poll(() => getLiveKitMicrophoneMuted(`voice-room-${roomId}`, login), { timeout: 15_000 }).toBe(false);
    await expect.poll(() => energyDelta(listener, 1000), { timeout: 15_000 }).toBeGreaterThan(0.001);
    await speaker.keyboard.up('v');
  } finally {
    await speakerContext.close();
    await listenerContext.close();
  }
});

test('muted raw loss completes SDK unpublication and permits an audible explicit microphone attachment', async ({
  browser
}) => {
  test.setTimeout(120_000);
  const speakerContext = await browser.newContext();
  const listenerContext = await browser.newContext();
  await speakerContext.addInitScript(installCaptureFailureProbe);
  await listenerContext.addInitScript(installPeerProbe);
  try {
    const speaker = await speakerContext.newPage();
    const listener = await listenerContext.newPage();
    const login = uniqueLogin('reattachmic');
    await registerViaUi(speaker, login);
    const roomId = await createPermanentRoom(speaker, `Explicit source ${login}`);
    await enterRoom(speaker, roomId);
    await expect(speaker.locator('.room-topbar__status--connected')).toContainText('Голос подключен', {
      timeout: 30_000
    });
    await registerViaUi(listener, uniqueLogin('reattachlistener'));
    await enterRoom(listener, roomId);
    await expect(listener.locator('.room-topbar__status--connected')).toContainText('Голос подключен', {
      timeout: 30_000
    });
    await expect.poll(() => energyDelta(listener, 1000), { timeout: 15_000 }).toBeGreaterThan(0.001);
    const mic = speaker.locator('.room-dock__button--mic');
    await mic.click();
    await expect(mic).toHaveAttribute('aria-label', 'Включить микрофон');
    expect(await speaker.evaluate(() => window.endCurrentMicrophone?.() ?? 0)).toBeGreaterThan(0);
    await expect(mic).toHaveAttribute('aria-label', 'Микрофона нет: подключить');
    await expect.poll(() => getLiveKitMicrophoneMuted(`voice-room-${roomId}`, login), { timeout: 15_000 }).toBeNull();
    await mic.click();
    await expect(mic).toHaveAttribute('aria-label', 'Выключить микрофон');
    await expect(speaker.locator('.room-topbar__status--connected')).toContainText('Голос подключен');
    await expect.poll(() => getLiveKitMicrophoneMuted(`voice-room-${roomId}`, login), { timeout: 15_000 }).toBe(false);
    await expect.poll(() => energyDelta(listener, 1000), { timeout: 15_000 }).toBeGreaterThan(0.001);
  } finally {
    await speakerContext.close();
    await listenerContext.close();
  }
});

test('a raw microphone ending before connection joins explicitly listen-only without publishing a dead capture', async ({
  browser
}) => {
  const context = await browser.newContext();
  await context.addInitScript(installCaptureFailureProbe);
  try {
    const page = await context.newPage();
    const login = uniqueLogin('endedmic');
    await registerViaUi(page, login);
    const roomId = await createPermanentRoom(page, `Prepared source ${login}`);
    let stoppedTracks = 0;
    await page.route('**/api/livekit-token', async (route) => {
      // Only synthetic Chromium media is captured. Ending it before the token
      // arrives exercises the real prepared graph, not a mocked publication.
      stoppedTracks += await page.evaluate(() => window.endPreparedMicrophone?.() ?? 0);
      await route.continue();
    });
    await enterRoom(page, roomId);
    await expect(page.locator('.room-topbar__status--connected')).toContainText('Голос подключен', {
      timeout: 30_000
    });
    expect(stoppedTracks).toBeGreaterThan(0);
    await expect(page.locator('.room-dock__button--mic')).toHaveAttribute('aria-label', 'Микрофона нет: подключить');
    expect(await getLiveKitMicrophoneMuted(`voice-room-${roomId}`, login)).toBeNull();
  } finally {
    await context.close();
  }
});

test('raw loss during a failed manual acquisition recovers automatically and is audible to a second peer', async ({
  browser
}) => {
  test.setTimeout(120_000);
  const speakerContext = await browser.newContext();
  const listenerContext = await browser.newContext();
  await speakerContext.addInitScript(installPeerProbe);
  await speakerContext.addInitScript(installCaptureFailureProbe);
  await listenerContext.addInitScript(installPeerProbe);
  try {
    const speaker = await speakerContext.newPage();
    const listener = await listenerContext.newPage();
    const login = uniqueLogin('busymic');
    await registerViaUi(speaker, login);
    const roomId = await createPermanentRoom(speaker, `Busy source ${login}`);
    await enterRoom(speaker, roomId);
    await expect(speaker.locator('.room-topbar__status--connected')).toContainText('Голос подключен', {
      timeout: 30_000
    });
    await registerViaUi(listener, uniqueLogin('busymiclistener'));
    await enterRoom(listener, roomId);
    await expect(listener.locator('.room-topbar__status--connected')).toContainText('Голос подключен', {
      timeout: 30_000
    });
    await expect.poll(() => energyDelta(listener, 1000), { timeout: 15_000 }).toBeGreaterThan(0.001);
    const originalTrack = await speaker.evaluate(() => window.audioSenderTrackId?.() ?? '');
    expect(originalTrack).not.toBe('');
    expect(await speaker.evaluate(() => window.failNextMicrophoneAndEndCurrent?.() ?? false)).toBe(true);
    await speaker.getByRole('button', { name: 'Выбрать микрофон' }).click();
    await speaker.getByRole('combobox', { name: 'Шумоподавление' }).click();
    await speaker.getByRole('option', { name: 'Браузерный' }).click();
    await expect.poll(() => speaker.evaluate(() => window.microphoneFailures?.() ?? 0)).toBe(1);
    await expect
      .poll(() => speaker.evaluate(() => window.audioSenderTrackId?.() ?? ''), { timeout: 15_000 })
      .not.toBe(originalTrack);
    await expect.poll(() => getLiveKitMicrophoneMuted(`voice-room-${roomId}`, login), { timeout: 15_000 }).toBe(false);
    await expect.poll(() => energyDelta(listener, 1000), { timeout: 15_000 }).toBeGreaterThan(0.001);
  } finally {
    await speakerContext.close();
    await listenerContext.close();
  }
});
