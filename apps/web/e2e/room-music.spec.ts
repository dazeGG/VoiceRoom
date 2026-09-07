// Shared music (plan Step 5.5 / Verification step 5): AC-1, AC-3, AC-4.
//
// ⚠ THESE SPECS HAVE NEVER BEEN EXECUTED. They were written on a machine with
// no Docker daemon and no Postgres, so `npm run e2e` could not run at all. Treat
// the first real run as part of writing them: every assumption that could not be
// checked is called out inline with an "UNVERIFIED" comment rather than left
// buried. Selectors for the player itself come from the component source
// (`components/RoomMusicPanel.svelte`, `components/RoomDock.svelte`) and are the
// most trustworthy part; the stack's timing behaviour is the least.
//
// They are gated on E2E_MUSIC because the feature needs two things the default
// dev stack does not guarantee: a running `music-bot` container, and egress from
// that container to the source the link names. Without a reachable source the
// session is `unavailable` by design (AC-9), so an ungated spec would fail for a
// correct build. Gating follows the existing convention in g70-reactions.spec.ts.
//
// Not covered here, deliberately: audibility. There is no AnalyserNode or RMS
// instrumentation on the music lane anywhere in the app, so a spec asserting
// "it was audible" would be asserting nothing. AC-1's audible half stays manual.

import { expect, test, type Page, type WebSocket } from '@playwright/test';
import { createPermanentRoom, enterRoom, registerViaUi, uniqueLogin } from './helpers';

// A single-video link, not a playlist: AC-1 is about one item reaching playback,
// and expansion is AC-6's concern. VK by default, because `MUSIC_BOT_SOURCES`
// defaults to `vk,rutube` — a YouTube link would answer `source_unavailable` on
// a stock stack. UNVERIFIED: this specific video id has never been resolved by
// the bot. Override with E2E_MUSIC_LINK; expect to have to, because a public
// video can be pulled or start demanding registration at any time, and the VK
// extractor is the one most likely to break.
const MUSIC_LINK = process.env.E2E_MUSIC_LINK ?? 'https://vkvideo.ru/video-22822305_456241864';

const musicPanel = (page: Page) => page.getByRole('dialog', { name: 'Музыка комнаты' });
// The dock button shares its accessible name with the panel, so both locators
// are role-qualified to keep them apart.
const musicButton = (page: Page) => page.getByRole('button', { name: 'Музыка комнаты' });
const currentTrack = (page: Page) => musicPanel(page).locator('.room-music-current .room-music-track');
const queueItems = (page: Page) => musicPanel(page).locator('.room-music-queue-item');

/**
 * Records every `room.music.*` frame the app WebSocket delivers to this page.
 *
 * The bot is deliberately never a peer, so it has no tile and no roster entry —
 * there is nothing in the DOM that says "this client is subscribed to the bot".
 * The closest honest observable is that the client received the bot's identity,
 * which is the precondition for subscribing at all. Must be installed before
 * navigation, or the socket opens unobserved.
 */
function recordMusicFrames(page: Page): Array<{ type: string; payload: Record<string, unknown> }> {
  const frames: Array<{ type: string; payload: Record<string, unknown> }> = [];
  page.on('websocket', (socket: WebSocket) => {
    if (!new URL(socket.url()).pathname.startsWith('/api/ws')) return;
    socket.on('framereceived', (frame) => {
      const payload = typeof frame.payload === 'string' ? frame.payload : '';
      if (!payload.includes('room.music.')) return;
      try {
        const envelope = JSON.parse(payload) as { type?: string; payload?: Record<string, unknown> };
        if (envelope.type?.startsWith('room.music.')) {
          frames.push({ type: envelope.type, payload: envelope.payload ?? {} });
        }
      } catch {
        // A non-JSON frame is not ours to interpret.
      }
    });
  });
  return frames;
}

/**
 * Waits for voice to be connected.
 *
 * The music block rides only on an `active`-mode snapshot, which the server
 * sends after the voice join — so every music assertion has to wait for this
 * first or it races the snapshot that carries the player's state.
 */
async function waitForVoiceConnected(page: Page): Promise<void> {
  await expect(page.locator('.status-pill[data-state="connected"]'))
    .toContainText('Голос подключен', { timeout: 30_000 });
}

async function openMusicPanel(page: Page): Promise<void> {
  // Absence here is meaningful, not flaky: in a temporary room the control is
  // not rendered at all, so a failure on this line means the room is not static
  // or the snapshot never arrived.
  await expect(musicButton(page)).toBeVisible({ timeout: 20_000 });
  await musicButton(page).click();
  await expect(musicPanel(page)).toBeVisible();
}

async function enqueue(page: Page, link: string): Promise<void> {
  await musicPanel(page).locator('#roomMusicLinkInput').fill(link);
  await musicPanel(page).getByRole('button', { name: 'Добавить' }).click();
}

/**
 * Fails the test with a clear reason when the stack cannot reach the source,
 * instead of leaving a confusing assertion timeout behind. UNVERIFIED: assumes
 * the panel surfaces `unavailable` within this window.
 */
async function assertMusicAvailable(page: Page): Promise<void> {
  const unavailable = musicPanel(page).locator('.room-music-status');
  if (await unavailable.isVisible().catch(() => false)) {
    throw new Error(
      'music session is unavailable — check that music-bot is running and can reach the source in E2E_MUSIC_LINK'
    );
  }
}

test.describe('shared music', () => {
  // Every scenario needs the bot container and a source it can actually reach.
  test.beforeEach(() => {
    test.skip(
      process.env.E2E_MUSIC !== 'true',
      'E2E_MUSIC requires music-bot and egress to the source in E2E_MUSIC_LINK'
    );
  });

  test('AC-1 a link enqueued in a static room reaches a second client with the bot identity', async ({ browser, page }) => {
    const ownerFrames = recordMusicFrames(page);
    const login = uniqueLogin('musicowner');
    await registerViaUi(page, login);
    const roomId = await createPermanentRoom(page, `Music one ${login}`);
    await enterRoom(page, roomId);
    await waitForVoiceConnected(page);

    const listenerContext = await browser.newContext();
    const listener = await listenerContext.newPage();
    const listenerFrames = recordMusicFrames(listener);
    await registerViaUi(listener, uniqueLogin('musiclistener'));
    await enterRoom(listener, roomId);
    await waitForVoiceConnected(listener);

    try {
      await openMusicPanel(page);
      await assertMusicAvailable(page);
      await enqueue(page, MUSIC_LINK);

      // AC-1 allows up to 10s for the whole resolve-and-publish round trip.
      await expect(currentTrack(page)).toBeVisible({ timeout: 15_000 });
      const title = (await currentTrack(page).textContent())?.trim() || '';
      expect(title).not.toBe('');

      // The second client converges on the same item...
      await openMusicPanel(listener);
      await expect(currentTrack(listener)).toHaveText(title, { timeout: 15_000 });

      // ...and was told which LiveKit identity to subscribe to. Without this the
      // failure is silent: no error, just no sound. This is the strongest
      // assertion available from outside the page; whether the subscription
      // actually carries audio is manual verification.
      await expect
        .poll(() => listenerFrames.some((frame) => typeof frame.payload.musicBotIdentity === 'string'
          && (frame.payload.musicBotIdentity as string).length > 0), { timeout: 15_000 })
        .toBe(true);
      expect(ownerFrames.some((frame) => frame.type === 'room.music.state')).toBe(true);
    } finally {
      await listenerContext.close();
    }
  });

  test('AC-3 a client joining after playback starts receives the current item and the queue', async ({ browser, page }) => {
    const login = uniqueLogin('musiclate');
    await registerViaUi(page, login);
    const roomId = await createPermanentRoom(page, `Music late ${login}`);
    await enterRoom(page, roomId);
    await waitForVoiceConnected(page);
    await openMusicPanel(page);
    await assertMusicAvailable(page);

    // Two items, so the late joiner has both a current item and a queue to
    // receive. UNVERIFIED: assumes the same link enqueued twice yields a queued
    // second item rather than being rejected as a duplicate — the shared
    // contract dedupes by canonical id but the queue rule is the server's.
    await enqueue(page, MUSIC_LINK);
    await expect(currentTrack(page)).toBeVisible({ timeout: 15_000 });
    const title = (await currentTrack(page).textContent())?.trim() || '';
    await enqueue(page, MUSIC_LINK);
    await expect(queueItems(page)).not.toHaveCount(0, { timeout: 15_000 });
    const queuedCount = await queueItems(page).count();

    // Only now does the second client arrive. With autoSubscribe:false it
    // receives no TrackPublished for a publication that already existed, so this
    // is the scenario the client-side reconcile pass exists for.
    const lateContext = await browser.newContext();
    const late = await lateContext.newPage();
    const lateFrames = recordMusicFrames(late);
    try {
      await registerViaUi(late, uniqueLogin('musiclatejoin'));
      await enterRoom(late, roomId);
      await waitForVoiceConnected(late);
      await openMusicPanel(late);

      await expect(currentTrack(late)).toHaveText(title, { timeout: 15_000 });
      await expect(queueItems(late)).toHaveCount(queuedCount, { timeout: 15_000 });
      await expect
        .poll(() => lateFrames.some((frame) => typeof frame.payload.musicBotIdentity === 'string'
          && (frame.payload.musicBotIdentity as string).length > 0), { timeout: 15_000 })
        .toBe(true);
    } finally {
      await lateContext.close();
    }
  });

  test('AC-4 the master stopping playback clears the session for everyone', async ({ browser, page }) => {
    const login = uniqueLogin('musicstop');
    await registerViaUi(page, login);
    const roomId = await createPermanentRoom(page, `Music stop ${login}`);
    await enterRoom(page, roomId);
    await waitForVoiceConnected(page);

    const listenerContext = await browser.newContext();
    const listener = await listenerContext.newPage();
    try {
      await registerViaUi(listener, uniqueLogin('musicstoplistener'));
      await enterRoom(listener, roomId);
      await waitForVoiceConnected(listener);

      await openMusicPanel(page);
      await assertMusicAvailable(page);
      await enqueue(page, MUSIC_LINK);
      await expect(currentTrack(page)).toBeVisible({ timeout: 15_000 });

      await openMusicPanel(listener);
      await expect(currentTrack(listener)).toBeVisible({ timeout: 15_000 });

      // The room creator owns the room, so only this page renders the stop
      // control. That the listener does NOT is AC-7's UI half, asserted here
      // because the state to assert it against already exists.
      const stop = musicPanel(page).getByRole('button', { name: 'Остановить музыку' });
      await expect(stop).toBeVisible();
      await expect(musicPanel(listener).getByRole('button', { name: 'Остановить музыку' })).toHaveCount(0);
      await stop.click();

      // AC-4 requires ≤2s for everyone, and explicitly requires it to hold even
      // if the bot has hung — the server clears its own state either way.
      await expect(musicPanel(page).locator('.room-music-empty').first())
        .toHaveText('Ничего не играет.', { timeout: 5_000 });
      await expect(musicPanel(listener).locator('.room-music-empty').first())
        .toHaveText('Ничего не играет.', { timeout: 5_000 });
      await expect(currentTrack(listener)).toHaveCount(0);
    } finally {
      await listenerContext.close();
    }
  });

  test('the player is absent from a temporary room', async ({ page }) => {
    // Not one of the three ACs, but it is the cheapest possible check of the
    // rule that gates the whole feature, and it needs no source access at all.
    const login = uniqueLogin('musictemp');
    await registerViaUi(page, login);
    await page.getByRole('button', { name: 'Создать комнату' }).click();
    const dialog = page.getByRole('dialog', { name: 'Новая комната' });
    await expect(dialog).toBeVisible();
    // UNVERIFIED: assumes the temporary tab is labelled "Временная" — the
    // permanent one is "Постоянная" (helpers.ts asserts it) but the sibling
    // tab's label was not confirmed against the running app.
    await dialog.getByRole('tab', { name: 'Временная' }).click();
    await dialog.getByPlaceholder('Название комнаты').fill(`Music temp ${login}`);
    await dialog.getByRole('button', { name: 'Создать комнату' }).click();
    await expect(page.locator('body')).toHaveAttribute('data-screen', 'room', { timeout: 20_000 });
    await waitForVoiceConnected(page);

    await expect(musicButton(page)).toHaveCount(0);
  });
});
