// The feedback section: how many calls went well, why, and each answer with
// the numbers of its call; the period and rating narrow the list.

import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import type { AdminCallFeedbackPage } from '@voice-room/shared/contracts/feedback';
import { FeedbackPage } from '../src/pages/FeedbackPage.tsx';
import { renderAs, stubApi } from './helpers/harness.tsx';

afterEach(cleanup);

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 17, 12);

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
      },
      stay: null
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
      // An API a release behind sends no stay at all.
      quality: null
    }
  ]
};

test('the section shows how many calls went well, why, and each answer with its call', async () => {
  const calls = stubApi({
    'GET /api/admin/feedback': (url) => ({
      body:
        url.searchParams.get('rating') === 'bad'
          ? { ...page, entries: page.entries.filter((entry) => entry.rating === 'bad') }
          : page
    })
  });
  renderAs(<FeedbackPage />);

  expect(await screen.findByText('75%')).toBeTruthy();
  expect(screen.getByText('из 4 ответов')).toBeTruthy();
  const answers = screen.getByRole('table', { name: 'Ответы' });
  expect(answers.textContent).toContain('Гость');
  expect(answers.textContent).toContain('временная комната');
  expect(answers.textContent).toContain('эхо у Пети');
  expect(answers.textContent).toContain('Алиса · @alice');
  expect(answers.textContent).toContain('«Кухня»');
  // The call's numbers, the bad ones marked: losses of 6%, two reconnects, through the relay.
  for (const bad of ['потери 6%', 'переподкл. 2', 'TURN']) {
    expect(within(answers).getByText(bad).getAttribute('data-bad')).toBe('true');
  }

  await userEvent.click(screen.getByRole('radio', { name: 'Плохие' }));
  await waitFor(() => expect(screen.queryByText('@alice')).toBeNull());
  expect(calls.map((call) => call.url.search)).toEqual(['?days=30', '?days=30&rating=bad']);
});

test("a guest's answer names them, says where they came from, the worst moments and how the network went", async () => {
  const MINUTE = 60_000;
  const joinedAt = T0 - 60 * MINUTE;
  const [badAnswer] = page.entries;
  if (!badAnswer) throw new Error('the bad answer expected');
  const guestAnswer: AdminCallFeedbackPage = {
    ...page,
    entries: [
      {
        ...badAnswer,
        quality: {
          rttAvgMs: 37.5,
          inboundLossAvgPct: 0.1,
          outboundLossAvgPct: 0,
          jitterAvgMs: 6.4,
          reconnects: 2,
          transport: 'udp',
          rttMaxMs: 1109,
          inboundLossMaxPct: 13.3,
          outboundLossMaxPct: 0,
          jitterMaxMs: 20,
          cpuPressureMax: 'critical',
          cpuRelieved: true,
          micDrops: 3
        },
        stay: {
          id: 's1',
          roomId: 'gone',
          roomName: null,
          isStatic: false,
          account: null,
          guestName: 'выевыпк',
          guestId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
          client: 'browser',
          os: 'Windows',
          browser: 'Chrome',
          ipKey: '72840b70e58cccb2',
          location: 'Воронеж, Россия',
          joinedAt,
          leftAt: T0,
          network: [
            { at: joinedAt + 5_000, level: 'good' },
            { at: joinedAt + 20 * MINUTE, level: 'bad' },
            { at: joinedAt + 21 * MINUTE, level: 'good' }
          ]
        }
      }
    ]
  };
  stubApi({ 'GET /api/admin/feedback': { body: guestAnswer } });
  renderAs(<FeedbackPage />);

  const answers = await screen.findByRole('table', { name: 'Ответы' });
  expect(within(answers).getByText('выевыпк')).toBeTruthy();
  expect(answers.textContent).toContain('Воронеж, Россия');
  expect(answers.textContent).toContain('Chrome');
  // Fine averages, but the worst moments and the computer give the call away.
  expect(within(answers).getByText('пинг 37,5 мс (до 1 109 мс)').getAttribute('data-bad')).toBe('true');
  expect(within(answers).getByText('потери 0,1% (до 13,3%)').getAttribute('data-bad')).toBe('true');
  expect(within(answers).getByText('джиттер 6,4 мс (до 20 мс)').getAttribute('data-bad')).toBe('false');
  expect(within(answers).getByText('микрофон отключался 3').getAttribute('data-bad')).toBe('true');
  expect(within(answers).getByText('ПК перегружен · облегчённый шумодав').getAttribute('data-bad')).toBe('true');
  const network = within(answers).getByRole('img', { name: /сеть/ });
  expect(network.getAttribute('aria-label')).toMatch(/сеть в порядке, .*сеть плохая, .*сеть в порядке$/);
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
  renderAs(<FeedbackPage />);
  const answer = async (url: string, body: AdminCallFeedbackPage) => {
    await waitFor(() => expect(replies.has(url)).toBe(true));
    replies.get(url)?.(body);
  };

  await answer('/api/admin/feedback?days=30', page);
  expect(await screen.findByText('75%')).toBeTruthy();

  await userEvent.click(screen.getByRole('radio', { name: 'Год' }));
  await userEvent.click(screen.getByRole('radio', { name: '7 дней' }));
  await answer('/api/admin/feedback?days=7', { ...page, days: 7, summary: { good: 1, bad: 1, tags: [] }, entries: [] });
  expect(await screen.findByText('50%')).toBeTruthy();
  await answer('/api/admin/feedback?days=365', page);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.getByText('50%')).toBeTruthy();
  expect(screen.queryByText('75%')).toBeNull();
});

test('a failed load says so and can be retried', async () => {
  let allowed = false;
  stubApi({
    'GET /api/admin/feedback': () =>
      allowed ? { body: page } : { status: 500, body: { ok: false, error: 'boom', code: 'internal_error' } }
  });
  renderAs(<FeedbackPage />);

  expect(await screen.findByRole('alert')).toBeTruthy();
  allowed = true;
  await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  expect(await screen.findByText('75%')).toBeTruthy();
});
