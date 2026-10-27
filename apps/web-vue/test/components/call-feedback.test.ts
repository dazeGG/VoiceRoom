// "How was the call?": when the app asks after a call, and the card that asks.
// The answers are read in the admin app (apps/admin).

import { render, screen, within } from '@testing-library/vue';
import { nextTick } from 'vue';
import userEvent from '@testing-library/user-event';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { CallFeedbackCall } from '@voice-room/shared/contracts/feedback';
import {
  FEEDBACK_ASK_INTERVAL_MS,
  FEEDBACK_MAX_INTERVAL_MS,
  nextAskAt,
  useCallFeedbackStore
} from '@/features/call-feedback/call-feedback.store';
import CallFeedbackPrompt from '@/features/call-feedback/CallFeedbackPrompt.vue';
import LeaveScreen from '@/features/room/components/LeaveScreen.vue';
import { useLeaveScreenStore } from '@/features/room/leave-screen.store';
import {
  finishCallQuality,
  recordNetworkSample,
  recordPeerCount,
  recordPollCounts,
  startCallQuality
} from '@/features/room/client/room/call-quality';
import { stubFetch } from '../fixtures/fetch';
import { renderWithApp } from '../helpers/render';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 17, 12);

const call: CallFeedbackCall = {
  roomId: 'kitchen',
  durationS: 25 * 60,
  peers: 2,
  platform: 'browser',
  quality: null
};

let feedback = useCallFeedbackStore(setActivePinia(createPinia()));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  const pinia = createPinia();
  setActivePinia(pinia);
  feedback = useCallFeedbackStore(pinia);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'visibilityState');
});

/** Renders the prompt and points the test's store at the one the page uses. */
async function renderPrompt(props: { hidden?: boolean } = {}) {
  const view = await renderWithApp(CallFeedbackPrompt, { props });
  feedback = useCallFeedbackStore(view.pinia);
  return view;
}

/** A call ends and the person leaves it themselves. */
function leave(at: number, finished: CallFeedbackCall = call): void {
  feedback.noteCallFinished(finished, at);
  feedback.offerCallFeedback(at + 200);
}

test('the next question waits three days, doubling with every one skipped, at most a month', () => {
  expect(nextAskAt(null)).toBe(0);
  expect(nextAskAt({ lastAskedAt: T0, skipped: 0 })).toBe(T0 + FEEDBACK_ASK_INTERVAL_MS);
  expect(nextAskAt({ lastAskedAt: T0, skipped: 1 })).toBe(T0 + 2 * FEEDBACK_ASK_INTERVAL_MS);
  expect(nextAskAt({ lastAskedAt: T0, skipped: 9 })).toBe(T0 + FEEDBACK_MAX_INTERVAL_MS);
});

test('only a call of a minute or more with somebody else in it is asked about', () => {
  leave(T0, { ...call, durationS: 40 });
  expect(feedback.call).toBeNull();
  leave(T0, { ...call, peers: 0 });
  expect(feedback.call).toBeNull();
  leave(T0);
  expect(feedback.call).toEqual(call);
});

test('a call that ended without the person leaving it is not asked about', () => {
  feedback.noteCallFinished(call, T0);
  feedback.offerCallFeedback(T0 + 60_000);
  expect(feedback.call).toBeNull();
  feedback.offerCallFeedback(T0 + 60_100);
  expect(feedback.call).toBeNull();
});

test('after a question the next waits three days, and longer when it was skipped', () => {
  leave(T0);
  feedback.skipCallFeedback();
  expect(feedback.call).toBeNull();

  leave(T0 + 4 * DAY);
  expect(feedback.call, 'a skipped question doubles the wait to six days').toBeNull();
  leave(T0 + 6 * DAY + 1000);
  expect(feedback.call).toEqual(call);
});

test('an answer is sent with the call and resets the wait to three days', async () => {
  const { calls } = stubFetch({ 'POST /api/feedback/calls': { status: 201, body: { ok: true } } });
  leave(T0);
  feedback.skipCallFeedback();
  leave(T0 + 7 * DAY);
  await feedback.answerCallFeedback({ rating: 'bad', tags: ['echo_noise'], comment: '  эхо у Пети  ' });
  expect(calls).toEqual([
    {
      method: 'POST',
      url: '/api/feedback/calls',
      body: { rating: 'bad', tags: ['echo_noise'], comment: 'эхо у Пети', call }
    }
  ]);
  expect(feedback.call).toBeNull();
  leave(T0 + 10 * DAY + 1000);
  expect(feedback.call).toEqual(call);
});

test('a question asked right before the page goes to the lobby is waiting there', () => {
  leave(T0);
  feedback.call = null; // the page unloads
  feedback.restorePendingCallFeedback(T0 + 3000);
  expect(feedback.call).toEqual(call);

  feedback.call = null;
  feedback.restorePendingCallFeedback(T0 + 4000);
  expect(feedback.call, 'it is picked up once').toBeNull();
});

test('a call reports its largest company along with its network numbers', () => {
  startCallQuality(0);
  recordPeerCount(1);
  recordPeerCount(3);
  recordPeerCount(2);
  recordNetworkSample({ inboundLossPct: 1, outboundLossPct: 0, jitterMs: 6, rttMs: 42, transport: 'udp' });
  recordPollCounts({
    inboundPackets: 200,
    inboundLost: 2,
    outboundPackets: 100,
    outboundLost: 0,
    rttSeconds: 0.126,
    rttChecks: 3,
    playedSamples: 96_000,
    concealedSamples: 960
  });
  expect(finishCallQuality(90_000)?.stats).toEqual({
    durationS: 90,
    peersMax: 3,
    rttAvgMs: 42,
    inboundLossAvgPct: 1,
    outboundLossAvgPct: 0,
    jitterAvgMs: 6,
    reconnects: 0,
    transport: 'udp',
    rttMaxMs: 42,
    inboundLossMaxPct: 1,
    outboundLossMaxPct: 0,
    jitterMaxMs: 6,
    cpuPressureMax: 'nominal',
    cpuRelieved: false,
    micDrops: 0,
    inboundPackets: 200,
    inboundLostPackets: 2,
    outboundPackets: 100,
    outboundLostPackets: 0,
    concealedAvgPct: 1,
    concealedMaxPct: 1,
    // A browser has no desktop load bridge.
    appCpuAvgPct: null,
    appCpuMaxPct: null,
    systemCpuAvgPct: null
  });
});

test('a thumb opens what went wrong; the answer goes with the tags and the comment', async () => {
  const { calls } = stubFetch({ 'POST /api/feedback/calls': { status: 201, body: { ok: true } } });
  await renderPrompt();
  feedback.call = call;

  // One window in the middle of the page, focus on the first thumb.
  expect(await screen.findByRole('dialog', { name: 'Как прошёл звонок?' })).toBeTruthy();
  await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Хорошо' })));
  expect(screen.getByText('Звонок длился 25 мин')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Отправить' })).toBeNull();

  await userEvent.click(screen.getByRole('button', { name: 'Хорошо' }));
  expect(screen.getByText('Что понравилось?')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Чистый звук' }));
  // Switching the thumb offers the other list and forgets the tags picked.
  await userEvent.click(screen.getByRole('button', { name: 'Плохо' }));
  expect(screen.getByText('Что пошло не так?')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Чистый звук' })).toBeNull();
  const echo = screen.getByRole('button', { name: 'Эхо или шум' });
  await userEvent.click(echo);
  expect(echo.getAttribute('aria-pressed')).toBe('true');
  await userEvent.type(screen.getByLabelText('Комментарий'), 'слышал себя');
  await userEvent.click(screen.getByRole('button', { name: 'Отправить' }));

  expect(screen.getByRole('status').textContent).toContain('Спасибо');
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0]?.body).toEqual({ rating: 'bad', tags: ['echo_noise'], comment: 'слышал себя', call });
});

test('the cross closes the question without an answer, and a chosen thumb is sent', async () => {
  const { calls } = stubFetch({ 'POST /api/feedback/calls': { status: 201, body: { ok: true } } });
  await renderPrompt();
  feedback.call = call;
  await userEvent.click(await screen.findByRole('button', { name: 'Закрыть' }));
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(calls).toHaveLength(0);

  feedback.call = call;
  await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Хорошо' })).toBeTruthy());
  await userEvent.click(screen.getByRole('button', { name: 'Хорошо' }));
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0]?.body).toEqual({ rating: 'good', tags: [], call });
});

test('a click beside the window closes it as the cross does', async () => {
  const { calls } = stubFetch({});
  await renderPrompt();
  leave(T0);
  const dialog = await screen.findByRole('dialog', { name: 'Как прошёл звонок?' });
  await userEvent.click(dialog);
  expect(feedback.call, 'a click inside keeps it').toEqual(call);

  const overlay = dialog.parentElement;
  if (!overlay) throw new Error('dialog has no overlay');
  // jsdom has no stylesheet, so the pointer-events rule of the overlay is not applied.
  await userEvent.setup({ pointerEventsCheck: 0 }).click(overlay);
  expect(feedback.call).toBeNull();
  expect(calls).toHaveLength(0);
  // Closed unanswered: the next question waits twice as long.
  leave(T0 + 4 * DAY);
  expect(feedback.call).toBeNull();
});

test('on the leave screen the question is the bottom of that window, not a second one', async () => {
  const { calls } = stubFetch({ 'POST /api/feedback/calls': { status: 201, body: { ok: true } } });
  const view = await renderWithApp(LeaveScreen);
  feedback = useCallFeedbackStore(view.pinia);
  const leaveScreen = useLeaveScreenStore(view.pinia);
  leaveScreen.openLeaveScreen({ roomId: 'kitchen', isStatic: false, guest: true });
  feedback.call = call;
  render(CallFeedbackPrompt, { props: { hidden: leaveScreen.open }, global: { plugins: [view.pinia, view.router] } });
  await nextTick();

  const window = screen.getByRole('dialog', { name: 'Вы вышли из комнаты' });
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  const question = within(window).getByRole('heading', { name: 'Как прошёл звонок?' });
  const offer = within(window).getByRole('button', { name: 'Создать аккаунт' });
  expect(
    offer.compareDocumentPosition(question) & Node.DOCUMENT_POSITION_FOLLOWING,
    'the offer comes first'
  ).toBeTruthy();
  expect(within(window).queryByRole('button', { name: 'Закрыть' }), 'the window has its own ways out').toBeNull();

  // A thumb alone is a whole answer: nothing else needs filling in.
  await userEvent.click(within(window).getByRole('button', { name: 'Плохо' }));
  expect(within(window).getByLabelText('Комментарий').getAttribute('placeholder')).not.toMatch(/необязательно/i);
  await userEvent.click(within(window).getByRole('button', { name: 'Задержка' }));
  await userEvent.click(within(window).getByRole('button', { name: 'Отправить' }));
  expect(within(window).getByRole('status').textContent).toContain('Спасибо за отзыв');
  expect(within(window).queryByRole('heading', { name: 'Как прошёл звонок?' })).toBeNull();
  expect(within(window).getByRole('button', { name: 'Создать аккаунт' })).toBeTruthy();
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0]?.body).toEqual({ rating: 'bad', tags: ['delay'], call });
});

function setVisibility(value: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
  document.dispatchEvent(new Event('visibilitychange'));
}

test('the question waits out a call, and goes away unanswered only after a minute in view', async () => {
  vi.useFakeTimers({ now: T0 });
  const view = await renderPrompt({ hidden: true });
  leave(T0);
  await vi.advanceTimersByTimeAsync(0);
  expect(screen.queryByRole('dialog')).toBeNull();

  await view.rerender({ hidden: false });
  expect(screen.getByRole('dialog', { name: 'Как прошёл звонок?' })).toBeTruthy();
  setVisibility('hidden');
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  expect(feedback.call, 'time in a hidden window does not count').toEqual(call);

  setVisibility('visible');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(feedback.call).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();

  // Going away unseen is no skip: the next question comes after the usual three days.
  leave(T0 + 3 * DAY + 1000);
  expect(feedback.call).toEqual(call);
});

test('a new call puts away an open question without counting it as skipped', () => {
  leave(T0);
  feedback.dropCallFeedback();
  expect(feedback.call).toBeNull();
  leave(T0 + 3 * DAY + 1000);
  expect(feedback.call).toEqual(call);
});

test('a leave before the next call was up is not taken for the previous call', () => {
  feedback.noteCallFinished(call, T0);
  feedback.noteCallFinished(null, T0 + 2000);
  feedback.offerCallFeedback(T0 + 2200);
  expect(feedback.call).toBeNull();
});

test('with storage blocked the wait still holds while the page is open', () => {
  const blocked = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
    removeItem: () => {
      throw new Error('blocked');
    }
  };
  vi.stubGlobal('localStorage', blocked);
  vi.stubGlobal('sessionStorage', blocked);
  leave(T0);
  expect(feedback.call).toEqual(call);
  feedback.skipCallFeedback();
  leave(T0 + DAY);
  expect(feedback.call).toBeNull();
});

test('Escape closes the question, and the next question starts with nothing chosen', async () => {
  await renderPrompt();
  feedback.call = call;
  await userEvent.click(await screen.findByRole('button', { name: 'Плохо' }));
  feedback.call = { ...call, roomId: 'hall' };
  await vi.waitFor(() =>
    expect(screen.getByRole('button', { name: 'Плохо' }).getAttribute('aria-pressed')).toBe('false')
  );
  expect(screen.queryByText('Что пошло не так?')).toBeNull();

  screen.getByRole('button', { name: 'Хорошо' }).focus();
  await userEvent.keyboard('{Escape}');
  expect(feedback.call).toBeNull();
});
