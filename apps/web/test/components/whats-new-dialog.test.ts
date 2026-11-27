// "What's new" runs like stories: slides turn on their own, hold while the
// reader points at them, wait behind a more urgent dialog, and each release is
// recorded as seen however the dialog closes.

import { fireEvent, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi, type MockInstance } from 'vitest';
import { defineComponent, h, ref, type VNode } from 'vue';
import { Dialog } from '@voiceroom/ui-kit/components';
import { WHATS_NEW_RELEASE } from '@/shared/whats-new-release';
import { useFriendCallStore } from '@/features/friend-call/friend-call.store';
import WhatsNewDialog from '@/features/home/components/WhatsNewDialog.vue';
import { WHATS_NEW_SLIDES, WHATS_NEW_SLIDE_MS } from '@/features/home/model/whats-new';
import { stubFetch } from '../fixtures/fetch';
import { stubMatchMedia } from '../helpers/match-media';
import { renderWithApp, type AppRenderOptions } from '../helpers/render';

let playVideo: MockInstance<HTMLMediaElement['play']>;
let pauseVideo: MockInstance<HTMLMediaElement['pause']>;

beforeEach(() => {
  stubMatchMedia();
  playVideo = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  pauseVideo = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

async function renderStory<C>(component: C, options?: AppRenderOptions<C>, callsEnabled = true) {
  const view = await renderWithApp(component, options);
  const calls = useFriendCallStore(view.pinia);
  calls.enabled = callsEnabled;
  calls.missedLoaded = true;
  return view;
}

function stubRelease(lastSeen: string | null) {
  return stubFetch({
    'GET /api/auth/whats-new': { body: { ok: true, whatsNew: { lastSeen } } },
    'POST /api/auth/whats-new/seen': {
      body: { ok: true, whatsNew: { lastSeen: WHATS_NEW_RELEASE } }
    }
  });
}

function host(render: () => VNode[]) {
  return defineComponent({ setup: () => render });
}

const title = () => document.querySelector('.stories__title')?.textContent;
const runningFill = () => document.querySelector('.stories__fill--run');

function currentVideo(label: string): HTMLVideoElement {
  const video = screen.getByLabelText(label);
  if (!(video instanceof HTMLVideoElement)) throw new Error('Expected the slide video');
  return video;
}

test('each slide shows a single labeled, muted, inline and looping video with its poster', async () => {
  stubRelease(null);
  await renderStory(WhatsNewDialog);
  await screen.findByRole('dialog');
  for (const [i, slide] of WHATS_NEW_SLIDES.entries()) {
    if (i > 0) await userEvent.keyboard('{ArrowRight}');
    const video = currentVideo(slide.alt);
    expect(document.querySelectorAll('video')).toHaveLength(1);
    expect(video.autoplay).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.preload).toBe('auto');
    expect(video.getAttribute('src')).toBe(slide.video);
    expect(video.getAttribute('poster')).toBe(slide.poster);
  }
});

test('reduced motion keeps the poster visible and the slides turn by hand', async () => {
  stubRelease(null);
  stubMatchMedia(['(prefers-reduced-motion: reduce)']);
  await renderStory(WhatsNewDialog);
  await screen.findByRole('dialog');
  const first = WHATS_NEW_SLIDES[0];
  const video = currentVideo(first.alt);
  expect(video.autoplay).toBe(false);
  expect(video.hasAttribute('src')).toBe(false);
  expect(video.getAttribute('poster')).toBe(first.poster);
  expect(playVideo).not.toHaveBeenCalled();
  expect(runningFill()).toBeNull();

  await userEvent.keyboard('{ArrowRight}');
  expect(title()).toBe(WHATS_NEW_SLIDES[1].title);
});

test('the calls slide is skipped when the account has calls disabled', async () => {
  stubRelease(null);
  await renderStory(WhatsNewDialog, undefined, false);
  await screen.findByRole('dialog', { name: WHATS_NEW_SLIDES[1].title });
  expect(screen.queryByLabelText(WHATS_NEW_SLIDES[0].alt)).toBeNull();
  expect(screen.getByText('Что нового в VoiceRoom · 1 из 3')).toBeTruthy();
  await userEvent.keyboard('{ArrowLeft}');
  expect(title()).toBe(WHATS_NEW_SLIDES[1].title);
});

test('the story waits for the calls bootstrap before choosing its first slide', async () => {
  const { calls } = stubRelease(null);
  const view = await renderWithApp(WhatsNewDialog);
  await vi.waitFor(() => expect(calls.some((call) => call.url === '/api/auth/whats-new')).toBe(true));
  expect(screen.queryByRole('dialog')).toBeNull();
  const friendCalls = useFriendCallStore(view.pinia);
  friendCalls.enabled = true;
  friendCalls.missedLoaded = true;
  expect(await screen.findByRole('dialog', { name: WHATS_NEW_SLIDES[0].title })).toBeTruthy();
});

test('progress waits for playback and hover holds the slide while the clip keeps playing', async () => {
  stubRelease(null);
  await renderStory(WhatsNewDialog);
  const first = WHATS_NEW_SLIDES[0];
  const dialog = await screen.findByRole('dialog', { name: first.title });
  expect(document.getElementById(dialog.getAttribute('aria-describedby') ?? '')?.textContent).toBe(first.text);

  const video = currentVideo(first.alt);
  const fill = runningFill();
  if (!(fill instanceof HTMLElement)) throw new Error('Expected the story progress');
  expect(fill.style.animationDuration).toBe(`${WHATS_NEW_SLIDE_MS}ms`);
  expect(fill.classList.contains('stories__fill--paused')).toBe(true);
  await fireEvent.playing(video);
  expect(fill.classList.contains('stories__fill--paused')).toBe(false);

  await fireEvent.pointerEnter(dialog, { pointerType: 'mouse' });
  expect(pauseVideo).not.toHaveBeenCalled();
  expect(video.autoplay).toBe(true);
  expect(fill.classList.contains('stories__fill--paused')).toBe(true);
  await fireEvent.pointerLeave(dialog, { pointerType: 'mouse' });
  expect(playVideo.mock.contexts).toEqual([video]);
  expect(fill.classList.contains('stories__fill--paused')).toBe(false);

  await fireEvent.animationEnd(fill);
  expect(title()).toBe(WHATS_NEW_SLIDES[1].title);
});

test('focusing a control holds the slide while the clip keeps playing', async () => {
  stubRelease(null);
  await renderStory(WhatsNewDialog);
  await screen.findByRole('dialog');
  const video = currentVideo(WHATS_NEW_SLIDES[0].alt);
  await fireEvent.playing(video);
  await fireEvent.focusIn(screen.getByRole('button', { name: 'Далее' }));
  expect(pauseVideo).not.toHaveBeenCalled();
  expect(video.autoplay).toBe(true);
  expect(runningFill()?.classList.contains('stories__fill--paused')).toBe(true);
});

test('the story waits behind a more urgent dialog and tells the lobby when it is up', async () => {
  stubRelease(null);
  const onOpenChange = vi.fn();
  const view = await renderStory(WhatsNewDialog, {
    props: { paused: true, onOpenAppearance: vi.fn(), onOpenChange }
  });
  await vi.waitFor(() => expect(document.querySelector('.stories__fill')).toBeNull());
  expect(screen.queryByRole('dialog')).toBeNull();

  await view.rerender({ paused: false, onOpenAppearance: vi.fn(), onOpenChange });
  expect(await screen.findByRole('dialog')).toBeTruthy();
  expect(onOpenChange).toHaveBeenLastCalledWith(true);
});

test('Escape closes it and records the release as seen', async () => {
  const { calls } = stubRelease(null);
  await renderStory(WhatsNewDialog, { props: { onOpenAppearance: vi.fn() } });
  await screen.findByRole('dialog');

  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  await vi.waitFor(() =>
    expect(calls.find((call) => call.url === '/api/auth/whats-new/seen')).toMatchObject({
      method: 'POST',
      body: { release: WHATS_NEW_RELEASE }
    })
  );
});

test('the last slide can open the appearance settings', async () => {
  stubRelease(null);
  const onOpenAppearance = vi.fn();
  await renderStory(WhatsNewDialog, { props: { onOpenAppearance } });
  await screen.findByRole('dialog');
  for (let i = 1; i < WHATS_NEW_SLIDES.length; i += 1) await userEvent.keyboard('{ArrowRight}');
  expect(title()).toBe(WHATS_NEW_SLIDES.at(-1)?.title);

  await userEvent.click(screen.getByRole('button', { name: 'Настроить' }));
  expect(onOpenAppearance).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('a release already seen is not shown', async () => {
  stubRelease(WHATS_NEW_RELEASE);
  await renderStory(WhatsNewDialog, { props: { onOpenAppearance: vi.fn() } });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('reverse Tab from the focused final slide stays inside the modal', async () => {
  stubRelease(null);
  const Host = host(() => [h('button', 'Background action'), h(WhatsNewDialog)]);
  await renderStory(Host);
  const dialog = await screen.findByRole('dialog');
  await vi.waitFor(() => expect(document.activeElement).toBe(dialog.querySelector('.stories__stage')));
  for (let i = 1; i < WHATS_NEW_SLIDES.length; i += 1) await userEvent.keyboard('{ArrowRight}');
  await userEvent.tab({ shift: true });
  expect(dialog.contains(document.activeElement)).toBe(true);
});

test('pausing for a real dialog does not mark seen and appearance receives final focus', async () => {
  const { calls } = stubRelease(null);
  const urgent = ref(false);
  const appearance = ref(false);
  const Host = host(() => [
    h(WhatsNewDialog, { paused: urgent.value, onOpenAppearance: () => (appearance.value = true) }),
    h(Dialog, { open: urgent.value, title: 'Urgent', onClose: () => (urgent.value = false) }),
    h(Dialog, { open: appearance.value, title: 'Appearance', onClose: () => (appearance.value = false) })
  ]);
  await renderStory(Host);
  await screen.findByRole('dialog');
  urgent.value = true;
  const urgentDialog = await screen.findByRole('dialog', { name: 'Urgent' });
  await vi.waitFor(() => expect(urgentDialog.contains(document.activeElement)).toBe(true));
  expect(calls.filter((call) => call.url === '/api/auth/whats-new/seen')).toHaveLength(0);
  await userEvent.keyboard('{Escape}');
  await vi.waitFor(() => expect(document.activeElement).toBe(document.querySelector('.stories__stage')));
  for (let i = 1; i < WHATS_NEW_SLIDES.length; i += 1) await userEvent.keyboard('{ArrowRight}');
  await userEvent.click(screen.getByRole('button', { name: 'Настроить' }));
  const settings = await screen.findByRole('dialog', { name: 'Appearance' });
  await vi.waitFor(() => expect(settings.contains(document.activeElement)).toBe(true));
  expect(calls.filter((call) => call.url === '/api/auth/whats-new/seen')).toHaveLength(1);
});
