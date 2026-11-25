import { render, screen, within } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { Button, IncomingCallCard } from '@voiceroom/ui-kit/components';
import { stubOverlayDom } from '../helpers/overlay-dom';

const caller = { name: 'Аня' };
beforeEach(stubOverlayDom);
afterEach(() => vi.useRealTimers());

test('the room-switch note describes accept only while a room name is present', async () => {
  const view = render(IncomingCallCard, { props: { caller, expiresAt: Date.now() + 30_000 } });
  const region = screen.getByRole('region', { name: 'Аня звонит вам' });
  const accept = within(region).getByRole('button', { name: 'Принять' });
  expect(accept.hasAttribute('aria-describedby')).toBe(false);
  expect(within(region).queryByText(/Вы покинете/)).toBeNull();

  await view.rerender({ leaveRoomName: 'Вечерний созвон' });
  expect(within(region).getByRole('button', { name: 'Принять', description: 'Вы покинете «Вечерний созвон»' })).toBe(
    accept
  );
  expect(within(region).getByRole('button', { name: 'Отклонить' }).hasAttribute('aria-describedby')).toBe(false);
});

test('coming in leaves existing focus in place and the silence control remains reachable and stable', async () => {
  const visible = ref(false);
  const silenced = ref(false);
  const toggle = vi.fn(() => (silenced.value = !silenced.value));
  render(
    defineComponent(() => () => [
      h(Button, { onClick: () => (visible.value = true) }, () => 'Открыть личные сообщения'),
      visible.value
        ? h(IncomingCallCard, {
            caller,
            expiresAt: Date.now() + 30_000,
            silenced: silenced.value,
            onToggleSilence: toggle
          })
        : null
    ])
  );
  const user = userEvent.setup();
  const currentTask = screen.getByRole('button', { name: 'Открыть личные сообщения' });
  await user.click(currentTask);
  expect(document.activeElement).toBe(currentTask);

  await user.tab();
  const silence = screen.getByRole('button', { name: 'Выключить звук звонка', pressed: false });
  expect(document.activeElement).toBe(silence);
  await user.keyboard('{Enter}');
  expect(toggle).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Включить звук звонка', pressed: true })).toBe(silence);
  expect(document.activeElement).toBe(silence);
  expect(screen.getByText('Звук звонка выключен')).toBeTruthy();
});

test('compact call actions identify their caller and emit once per activation', async () => {
  const props = { variant: 'compact', expiresAt: Date.now() + 30_000 } as const;
  const first = render(IncomingCallCard, { props: { ...props, caller } });
  const second = render(IncomingCallCard, { props: { ...props, caller: { name: 'Лена' } } });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Отклонить: Аня' }));
  await user.click(screen.getByRole('button', { name: 'Принять: Лена' }));
  expect(first.emitted('decline')).toEqual([[]]);
  expect(first.emitted('accept')).toBeUndefined();
  expect(second.emitted('accept')).toEqual([[]]);
  expect(second.emitted('decline')).toBeUndefined();
});

test.each(['default', 'compact'] as const)('accepting blocks decline on a %s card', async (variant) => {
  const view = render(IncomingCallCard, {
    props: { caller, expiresAt: Date.now() + 30_000, state: 'accepting', variant }
  });
  const decline = screen.getByRole('button', { name: /^Отклонить/ });
  expect(decline).toHaveProperty('disabled', true);
  const accept = screen.getByRole('button', { name: 'Подключаемся…', busy: true });
  expect(accept).toHaveProperty('disabled', true);
  await userEvent.click(decline);
  expect(view.emitted('decline')).toBeUndefined();
});

test('the decorative track reaches zero at the attempt deadline and actions are disabled', async () => {
  vi.useFakeTimers();
  render(IncomingCallCard, { props: { caller, expiresAt: Date.now() + 1250 } });
  expect(screen.queryByRole('progressbar')).toBeNull();
  const track = screen.getByRole('progressbar', { hidden: true });
  expect(Number(track.getAttribute('aria-valuenow'))).toBeGreaterThan(0);

  await vi.advanceTimersByTimeAsync(1249);
  const accept = screen.getByRole('button', { name: 'Принять' });
  expect(accept).toHaveProperty('disabled', false);
  await vi.advanceTimersByTimeAsync(1);
  expect(track.getAttribute('aria-valuenow')).toBe('0');
  expect(accept).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: 'Отклонить' })).toHaveProperty('disabled', true);
});
