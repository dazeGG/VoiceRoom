// "How was the call?": when the app asks after a call, the card that asks,
// and the admin panel tab that reads the answers.

import { cleanup, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { AdminCallFeedbackPage, CallFeedbackCall } from '@voice-room/shared/contracts/feedback';
import {
  FEEDBACK_ASK_INTERVAL_MS,
  FEEDBACK_MAX_INTERVAL_MS,
  answerCallFeedback,
  callFeedback,
  dropCallFeedback,
  nextAskAt,
  noteCallFinished,
  offerCallFeedback,
  restorePendingCallFeedback,
  skipCallFeedback
} from '../../src/lib/features/call-feedback/call-feedback.svelte.ts';
import CallFeedbackPrompt from '../../src/lib/features/call-feedback/CallFeedbackPrompt.svelte';
import CallFeedbackReview from '../../src/lib/features/admin/CallFeedbackReview.svelte';
import LeaveScreen from '../../src/lib/features/room/components/LeaveScreen.svelte';
import { leaveScreenUi, openLeaveScreen } from '../../src/lib/features/room/leave-screen.svelte.ts';
import {
  finishCallQuality,
  recordNetworkSample,
  recordPeerCount,
  startCallQuality
} from '../../src/lib/features/room/client/room/call-quality.ts';
import { stubFetch } from '../fixtures/fetch.ts';
import { defined } from '../helpers/assert.ts';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 17, 12);

const call: CallFeedbackCall = {
  roomId: 'kitchen',
  durationS: 25 * 60,
  peers: 2,
  platform: 'browser',
  quality: null
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  callFeedback.call = null;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'visibilityState');
});

/** A call ends and the person leaves it themselves. */
function leave(at: number, finished: CallFeedbackCall = call): void {
  noteCallFinished(finished, at);
  offerCallFeedback(at + 200);
}

test('the next question waits three days, doubling with every one skipped, at most a month', () => {
  expect(nextAskAt(null)).toBe(0);
  expect(nextAskAt({ lastAskedAt: T0, skipped: 0 })).toBe(T0 + FEEDBACK_ASK_INTERVAL_MS);
  expect(nextAskAt({ lastAskedAt: T0, skipped: 1 })).toBe(T0 + 2 * FEEDBACK_ASK_INTERVAL_MS);
  expect(nextAskAt({ lastAskedAt: T0, skipped: 9 })).toBe(T0 + FEEDBACK_MAX_INTERVAL_MS);
});

test('only a call of a minute or more with somebody else in it is asked about', () => {
  leave(T0, { ...call, durationS: 40 });
  expect(callFeedback.call).toBeNull();
  leave(T0, { ...call, peers: 0 });
  expect(callFeedback.call).toBeNull();
  leave(T0);
  expect(callFeedback.call).toEqual(call);
});

test('a call that ended without the person leaving it is not asked about', () => {
  noteCallFinished(call, T0);
  offerCallFeedback(T0 + 60_000);
  expect(callFeedback.call).toBeNull();
  offerCallFeedback(T0 + 60_100);
  expect(callFeedback.call).toBeNull();
});

test('after a question the next waits three days, and longer when it was skipped', () => {
  leave(T0);
  skipCallFeedback();
  expect(callFeedback.call).toBeNull();

  leave(T0 + 4 * DAY);
  expect(callFeedback.call, 'a skipped question doubles the wait to six days').toBeNull();
  leave(T0 + 6 * DAY + 1000);
  expect(callFeedback.call).toEqual(call);
});

test('an answer is sent with the call and resets the wait to three days', async () => {
  const { calls } = stubFetch({ 'POST /api/feedback/calls': { status: 201, body: { ok: true } } });
  leave(T0);
  skipCallFeedback();
  leave(T0 + 7 * DAY);
  await answerCallFeedback({ rating: 'bad', tags: ['echo_noise'], comment: '  эхо у Пети  ' });
  expect(calls).toEqual([
    {
      method: 'POST',
      url: '/api/feedback/calls',
      body: { rating: 'bad', tags: ['echo_noise'], comment: 'эхо у Пети', call }
    }
  ]);
  expect(callFeedback.call).toBeNull();
  leave(T0 + 10 * DAY + 1000);
  expect(callFeedback.call).toEqual(call);
});

test('a question asked right before the page goes to the lobby is waiting there', () => {
  leave(T0);
  callFeedback.call = null; // the page unloads
  restorePendingCallFeedback(T0 + 3000);
  expect(callFeedback.call).toEqual(call);

  callFeedback.call = null;
  restorePendingCallFeedback(T0 + 4000);
  expect(callFeedback.call, 'it is picked up once').toBeNull();
});

test('a call reports its largest company along with its network numbers', () => {
  startCallQuality(0);
  recordPeerCount(1);
  recordPeerCount(3);
  recordPeerCount(2);
  recordNetworkSample({ inboundLossPct: 1, outboundLossPct: 0, jitterMs: 6, rttMs: 42, transport: 'udp' });
  expect(finishCallQuality(90_000)?.stats).toEqual({
    durationS: 90,
    peersMax: 3,
    rttAvgMs: 42,
    inboundLossAvgPct: 1,
    outboundLossAvgPct: 0,
    jitterAvgMs: 6,
    reconnects: 0,
    transport: 'udp'
  });
});

test('a thumb opens what went wrong; the answer goes with the tags and the comment', async () => {
  const { calls } = stubFetch({ 'POST /api/feedback/calls': { status: 201, body: { ok: true } } });
  callFeedback.call = call;
  render(CallFeedbackPrompt);

  // One window in the middle of the page, focus on the first thumb.
  expect(screen.getByRole('dialog', { name: 'Как прошёл звонок?' })).toBeTruthy();
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
  callFeedback.call = call;
  render(CallFeedbackPrompt);
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
  expect(screen.queryByRole('heading', { name: 'Как прошёл звонок?' })).toBeNull();
  expect(calls).toHaveLength(0);

  callFeedback.call = call;
  await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Хорошо' })).toBeTruthy());
  await userEvent.click(screen.getByRole('button', { name: 'Хорошо' }));
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0]?.body).toEqual({ rating: 'good', tags: [], call });
});

test('a click beside the window closes it as the cross does', async () => {
  const { calls } = stubFetch({});
  leave(T0);
  render(CallFeedbackPrompt);
  await userEvent.click(screen.getByRole('dialog', { name: 'Как прошёл звонок?' }));
  expect(callFeedback.call, 'a click inside keeps it').toEqual(call);

  await userEvent.click(screen.getByRole('presentation'));
  expect(callFeedback.call).toBeNull();
  expect(calls).toHaveLength(0);
  // Closed unanswered: the next question waits twice as long.
  leave(T0 + 4 * DAY);
  expect(callFeedback.call).toBeNull();
});

test('on the leave screen the question is the bottom of that window, not a second one', async () => {
  const { calls } = stubFetch({ 'POST /api/feedback/calls': { status: 201, body: { ok: true } } });
  openLeaveScreen({ roomId: 'kitchen', isStatic: false, guest: true });
  callFeedback.call = call;
  render(LeaveScreen);
  render(CallFeedbackPrompt, { props: { hidden: leaveScreenUi.open } });

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
  leaveScreenUi.open = false;
});

function setVisibility(value: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
  document.dispatchEvent(new Event('visibilitychange'));
}

test('the question waits out a call, and goes away unanswered only after a minute in view', async () => {
  vi.useFakeTimers({ now: T0 });
  leave(T0);
  const view = render(CallFeedbackPrompt, { props: { hidden: true } });
  expect(screen.queryByRole('heading', { name: 'Как прошёл звонок?' })).toBeNull();

  await view.rerender({ hidden: false });
  expect(screen.getByRole('heading', { name: 'Как прошёл звонок?' })).toBeTruthy();
  setVisibility('hidden');
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  expect(callFeedback.call, 'time in a hidden window does not count').toEqual(call);

  setVisibility('visible');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(callFeedback.call).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Как прошёл звонок?' })).toBeNull();

  // Going away unseen is no skip: the next question comes after the usual three days.
  leave(T0 + 3 * DAY + 1000);
  expect(callFeedback.call).toEqual(call);
});

test('a new call puts away an open question without counting it as skipped', () => {
  leave(T0);
  dropCallFeedback();
  expect(callFeedback.call).toBeNull();
  leave(T0 + 3 * DAY + 1000);
  expect(callFeedback.call).toEqual(call);
});

test('a leave before the next call was up is not taken for the previous call', () => {
  noteCallFinished(call, T0);
  noteCallFinished(null, T0 + 2000);
  offerCallFeedback(T0 + 2200);
  expect(callFeedback.call).toBeNull();
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
  expect(callFeedback.call).toEqual(call);
  skipCallFeedback();
  leave(T0 + DAY);
  expect(callFeedback.call).toBeNull();
});

test('Escape closes the question, and the next question starts with nothing chosen', async () => {
  callFeedback.call = call;
  render(CallFeedbackPrompt);
  await userEvent.click(screen.getByRole('button', { name: 'Плохо' }));
  callFeedback.call = { ...call, roomId: 'hall' };
  await vi.waitFor(() =>
    expect(screen.getByRole('button', { name: 'Плохо' }).getAttribute('aria-pressed')).toBe('false')
  );
  expect(screen.queryByText('Что пошло не так?')).toBeNull();

  screen.getByRole('button', { name: 'Хорошо' }).focus();
  await userEvent.keyboard('{Escape}');
  expect(callFeedback.call).toBeNull();
});

const page: AdminCallFeedbackPage = {
  ok: true,
  days: 30,
  summary: {
    good: 3,
    bad: 1,
    tags: [
      { tag: 'sound', count: 2 },
      { tag: 'echo_noise', count: 1 }
    ]
  },
  entries: [
    {
      id: 'f1',
      rating: 'bad',
      tags: ['echo_noise'],
      comment: 'эхо у Пети',
      createdAt: T0,
      author: null,
      roomId: 'gone',
      roomName: null,
      durationS: 600,
      peers: 2,
      platform: 'mobile',
      quality: {
        rttAvgMs: 180,
        inboundLossAvgPct: 6,
        outboundLossAvgPct: 1,
        jitterAvgMs: 30,
        reconnects: 2,
        transport: 'relay'
      }
    },
    {
      id: 'f2',
      rating: 'good',
      tags: ['sound'],
      comment: '',
      createdAt: T0 - DAY,
      author: { userId: 'u1', login: 'alice', displayName: 'Алиса' },
      roomId: 'kitchen',
      roomName: 'Кухня',
      durationS: 3600,
      peers: 4,
      platform: 'desktop_app',
      quality: null
    }
  ]
};

test('the admin tab shows how many calls went well, why, and each answer with its call', async () => {
  const { calls } = stubFetch({
    'GET /api/admin/feedback?days=30': { body: page },
    'GET /api/admin/feedback?days=30&rating=bad': { body: { ...page, entries: [page.entries[0]] } }
  });
  render(CallFeedbackReview);

  expect(await screen.findByText('75%')).toBeTruthy();
  expect(screen.getByText('из 4 ответов')).toBeTruthy();
  const answers = screen.getByRole('list', { name: 'Ответы' });
  expect(answers.textContent).toContain('Гость');
  expect(answers.textContent).toContain('временная комната');
  expect(answers.textContent).toContain('эхо у Пети');
  expect(answers.textContent).toContain('потери 6%');
  expect(answers.textContent).toContain('переподключений 2');
  expect(answers.textContent).toContain('RELAY');
  expect(answers.textContent).toContain('Алиса (@alice)');
  expect(answers.textContent).toContain('«Кухня»');

  await userEvent.click(screen.getByRole('radio', { name: 'Плохие' }));
  await vi.waitFor(() => expect(screen.queryByText('Алиса (@alice)', { exact: false })).toBeNull());
  expect(calls.map((item) => item.url)).toEqual([
    '/api/admin/feedback?days=30',
    '/api/admin/feedback?days=30&rating=bad'
  ]);
});

test('a slow reply for an earlier choice does not replace the latest one', async () => {
  const replies = new Map<string, (body: AdminCallFeedbackPage) => void>();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (url: string) =>
        new Promise<Response>((resolve) => {
          replies.set(url, (body) => resolve(new Response(JSON.stringify(body), { status: 200 })));
        })
    )
  );
  render(CallFeedbackReview);
  await vi.waitFor(() => expect(replies.has('/api/admin/feedback?days=30')).toBe(true));
  defined(replies.get('/api/admin/feedback?days=30'), 'month reply')(page);
  expect(await screen.findByText('75%')).toBeTruthy();

  await userEvent.click(screen.getByRole('radio', { name: 'Год' }));
  await userEvent.click(screen.getByRole('radio', { name: '7 дней' }));
  const week = { ...page, days: 7, summary: { good: 1, bad: 1, tags: [] }, entries: [] };
  defined(replies.get('/api/admin/feedback?days=7'), 'week reply')(week);
  expect(await screen.findByText('50%')).toBeTruthy();
  defined(replies.get('/api/admin/feedback?days=365'), 'year reply')(page);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.getByText('50%')).toBeTruthy();
  expect(screen.queryByText('75%')).toBeNull();
});
