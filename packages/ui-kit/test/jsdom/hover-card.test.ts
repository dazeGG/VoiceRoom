import { render, screen, waitFor } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
import { h } from 'vue';
import { HoverCard } from '@voiceroom/ui-kit/components';
import { stubMatchMedia } from '../../../../apps/web/test/helpers/match-media';
import { stubOverlayDom } from '../../../../apps/web/test/helpers/overlay-dom';

beforeEach(() => {
  stubOverlayDom();
  stubMatchMedia();
});

function renderCard() {
  render(HoverCard, {
    props: { ariaLabel: 'Профиль Ани' },
    slots: {
      trigger: () => h('button', { type: 'button' }, 'Аня'),
      default: () => h('button', { type: 'button' }, 'Написать')
    }
  });
  return screen.getByRole('button', { name: 'Аня' });
}

test('focusing the trigger opens a preview and keeps the focus on the trigger', async () => {
  const trigger = renderCard();
  expect(screen.queryByRole('dialog')).toBeNull();
  await userEvent.tab();
  expect(await screen.findByRole('dialog', { name: 'Профиль Ани' })).toBeTruthy();
  expect(document.activeElement).toBe(trigger);
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(trigger);
});

test('on a coarse pointer the trigger opens an interactive card on press', async () => {
  stubMatchMedia(['(pointer: coarse)']);
  const trigger = renderCard();
  await userEvent.tab();
  expect(screen.queryByRole('dialog')).toBeNull();
  await userEvent.click(trigger);
  expect(await screen.findByRole('dialog', { name: 'Профиль Ани' })).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Написать' })));
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('hover opens a preview after a delay and leaving the trigger dismisses it', async () => {
  const trigger = renderCard();
  await userEvent.hover(trigger);
  expect(screen.queryByRole('dialog')).toBeNull();
  await screen.findByRole('dialog', { name: 'Профиль Ани' });
  await userEvent.unhover(trigger);
  await userEvent.pointer({ target: document.body, coords: { clientX: 100, clientY: 100 } });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
