// The feedback section: how many calls went well, why, and each answer with
// the numbers of its call; the period and rating narrow the list.

import { cleanup, screen, waitFor } from '@testing-library/react';
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
  await waitFor(() => expect(screen.queryByText('Алиса (@alice)', { exact: false })).toBeNull());
  expect(calls.map((call) => call.url.search)).toEqual(['?days=30', '?days=30&rating=bad']);
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
