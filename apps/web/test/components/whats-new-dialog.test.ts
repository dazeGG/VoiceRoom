// "What's new" runs like stories: slides turn on their own, hold while the
// reader points at them, wait behind a more urgent dialog, and each release is
// recorded as seen however the dialog closes.

import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import WhatsNewDialog from '../../src/lib/features/home/components/WhatsNewDialog.svelte';
import { WHATS_NEW_SLIDES } from '../../src/lib/features/home/model/whats-new';
import { WHATS_NEW_VERSION } from '@voice-room/shared/account-security';
import { stubFetch } from '../fixtures/fetch.ts';
import { stubMatchMedia } from '../helpers/match-media.ts';

beforeEach(() => stubMatchMedia());
afterEach(cleanup);

function stubRelease(lastSeen: string | null) {
  return stubFetch({
    'GET /api/auth/whats-new': { body: { ok: true, whatsNew: { current: WHATS_NEW_VERSION, lastSeen } } },
    'POST /api/auth/whats-new/seen': {
      body: { ok: true, whatsNew: { current: WHATS_NEW_VERSION, lastSeen: WHATS_NEW_VERSION } }
    }
  });
}

const title = () => document.querySelector('#whatsNewSlideTitle')?.textContent;
const runningFill = () => document.querySelector('.stories-fill--run');

test('slides turn on their own and hold while the pointer is over the card', async () => {
  stubRelease(null);
  render(WhatsNewDialog, { props: { onOpenSecurity: vi.fn() } });
  await screen.findByRole('dialog');
  expect(title()).toBe(WHATS_NEW_SLIDES[0].title);

  await fireEvent.animationEnd(runningFill()!);
  expect(title()).toBe(WHATS_NEW_SLIDES[1].title);

  await fireEvent.pointerEnter(screen.getByRole('dialog'), { pointerType: 'mouse' });
  expect(runningFill()?.classList.contains('stories-fill--paused')).toBe(true);
  await fireEvent.pointerLeave(screen.getByRole('dialog'), { pointerType: 'mouse' });
  expect(runningFill()?.classList.contains('stories-fill--paused')).toBe(false);
});

test('the story waits behind a more urgent dialog and tells the lobby when it is up', async () => {
  stubRelease(null);
  const onOpenChange = vi.fn();
  const view = render(WhatsNewDialog, { props: { paused: true, onOpenSecurity: vi.fn(), onOpenChange } });
  await vi.waitFor(() => expect(document.querySelector('.stories-fill')).toBeNull());
  expect(screen.queryByRole('dialog')).toBeNull();

  await view.rerender({ paused: false, onOpenSecurity: vi.fn(), onOpenChange });
  expect(await screen.findByRole('dialog')).toBeTruthy();
  expect(onOpenChange).toHaveBeenLastCalledWith(true);
});

test('Escape closes it and records the release as seen', async () => {
  const { calls } = stubRelease(null);
  render(WhatsNewDialog, { props: { onOpenSecurity: vi.fn() } });
  await screen.findByRole('dialog');

  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  await vi.waitFor(() => expect(calls.some((call) => call.url === '/api/auth/whats-new/seen')).toBe(true));
});

test('the last slide can open the security settings', async () => {
  stubRelease(null);
  const onOpenSecurity = vi.fn();
  render(WhatsNewDialog, { props: { onOpenSecurity } });
  await screen.findByRole('dialog');
  for (let i = 1; i < WHATS_NEW_SLIDES.length; i += 1) await userEvent.keyboard('{ArrowRight}');
  expect(title()).toBe(WHATS_NEW_SLIDES.at(-1)?.title);

  await userEvent.click(screen.getByRole('button', { name: 'Настроить' }));
  expect(onOpenSecurity).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('a release already seen is not shown', async () => {
  stubRelease(WHATS_NEW_VERSION);
  render(WhatsNewDialog, { props: { onOpenSecurity: vi.fn() } });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(screen.queryByRole('dialog')).toBeNull();
});
