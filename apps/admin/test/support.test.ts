// The support section: the threads of one status with both counts, the
// conversation shown with VoiceRoom's answers and who wrote them, team notes as
// info callouts, marking read only when a staff member opens a conversation in
// a visible page, answering as VoiceRoom (once per retried answer) or noting
// for the team, resolving and its refusal over a new message, the states after
// the person deleted the conversation or lost the account, the menu badge only
// for staff who may answer, and the list asked again every minute.

import { cleanup, screen, waitFor, within } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { ROLE_PERMISSIONS } from '@voiceroom/shared/contracts/staff';
import type {
  SupportMessage,
  SupportNote,
  SupportThread,
  SupportThreadList,
  SupportThreadSummary
} from '@voiceroom/shared/contracts/support';
import SupportPage from '../src/pages/SupportPage.vue';
import SidebarNavigation from '../src/shell/SidebarNavigation.vue';
import { allowedTabs } from '../src/tabs.ts';
import { stubApi } from './helpers/api.ts';
import { renderAsStaff, renderWithApp } from './helpers/render.ts';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setVisibility('visible');
});

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

const AT = Date.UTC(2026, 10, 27, 11, 2);

function person(id: string, name: string) {
  return {
    id,
    login: name.toLowerCase(),
    displayName: name,
    avatarUrl: null,
    avatarColorKey: 'blue',
    avatarAccent: null
  };
}

function summary(id: string, name: string, overrides: Partial<SupportThreadSummary> = {}): SupportThreadSummary {
  return {
    person: person(id, name),
    status: 'open',
    unread: false,
    lastUserMessageAt: AT,
    lastMessage: { text: `вопрос ${name}`, at: AT, fromStaff: false, hasAttachments: false },
    ...overrides
  };
}

function listOf(threads: SupportThreadSummary[], counts = { open: 2, resolved: 1 }, openUnread = 1): SupportThreadList {
  return { ok: true, threads, counts, openUnread };
}

const message = (id: string, overrides: Partial<SupportMessage> = {}): SupportMessage => ({
  id,
  fromPerson: true,
  body: `текст ${id}`,
  createdAt: AT,
  attachments: [],
  staffName: null,
  ...overrides
});

const note = (id: string, body: string, createdAt = AT + 60_000): SupportNote => ({
  id,
  body,
  createdAt,
  authorName: 'Админ'
});

function threadOf(id: string, name: string, overrides: Partial<SupportThread> = {}): SupportThread {
  return {
    ok: true,
    person: person(id, name),
    personState: 'active',
    official: {
      displayName: 'VoiceRoom',
      avatarUrl: '/api/avatars/official.webp',
      avatarColorKey: 'olive',
      avatarAccent: '#080800'
    },
    status: 'open',
    resolvedAt: null,
    conversationDeleted: false,
    messages: [
      message('m1'),
      message('m2', {
        fromPerson: false,
        body: 'Спасибо, чиним',
        createdAt: AT + 120_000,
        staffName: 'Root'
      })
    ],
    notes: [note('n1', 'Теряется устройство вывода')],
    ...overrides
  };
}

function routes(extra: Parameters<typeof stubApi>[0] = {}) {
  return stubApi({
    'GET /api/admin/support/threads': (url) =>
      url.searchParams.get('status') === 'resolved'
        ? { body: listOf([summary('u-lev', 'Лев', { status: 'resolved' })]) }
        : {
            body: listOf([
              summary('u-kira', 'Кира', { unread: true }),
              summary('u-sergey', 'Сергей', {
                lastMessage: { text: 'Спасибо, что прислали журнал', at: AT, fromStaff: true, hasAttachments: false }
              })
            ])
          },
    'GET /api/admin/support/threads/u-kira': { body: threadOf('u-kira', 'Кира') },
    'GET /api/admin/support/threads/u-sergey': { body: threadOf('u-sergey', 'Сергей') },
    'GET /api/admin/support/threads/u-lev': { body: threadOf('u-lev', 'Лев', { status: 'resolved', resolvedAt: AT }) },
    'POST /api/admin/support/threads/u-kira/read': { body: { ok: true, openUnread: 0 } },
    'POST /api/admin/support/threads/u-sergey/read': { body: { ok: true, openUnread: 1 } },
    ...extra
  });
}

const rows = (name: string) => within(screen.getByRole('list', { name })).getAllByRole('button');
const conversation = (name: string) => screen.findByRole('region', { name });
const reads = (calls: Array<{ url: URL }>) =>
  calls.filter((call) => call.url.pathname.endsWith('/read')).map((call) => call.url.pathname.split('/')[5]);

test('the open list shows counts, unread and «Вы:» previews; the segment switches to resolved', async () => {
  const calls = routes();
  const onUnread = vi.fn();
  renderAsStaff(SupportPage, { props: { onUnread, onOpenAccount: vi.fn() } }, 'superadmin');

  const tabs = await screen.findByRole('tablist', { name: 'Обращения по статусу' });
  const [open, resolved] = within(tabs).getAllByRole('tab');
  expect(open?.textContent).toContain('Открытые');
  expect(open?.textContent).toContain('2');
  expect(open?.getAttribute('aria-selected')).toBe('true');
  expect(resolved?.textContent).toContain('1');
  const [kira, sergey] = rows('Открытые');
  expect(within(kira ?? document.body).getByText('не прочитано')).toBeTruthy();
  expect(within(sergey ?? document.body).getByText('Вы: Спасибо, что прислали журнал')).toBeTruthy();
  // The newest one is shown and marked as the current row, but nobody opened it: it stays unread.
  await conversation('Кира');
  expect(kira?.getAttribute('aria-current')).toBe('true');
  expect(sergey?.hasAttribute('aria-current')).toBe(false);
  expect(onUnread).toHaveBeenLastCalledWith(1);
  expect(reads(calls)).toEqual([]);
  expect(within(kira ?? document.body).getByText('не прочитано')).toBeTruthy();
  // Opening it marks it read for staff: the badge count follows.
  if (!kira) throw new Error('row expected');
  await userEvent.click(kira);
  await waitFor(() => expect(onUnread).toHaveBeenLastCalledWith(0));
  expect(reads(calls)).toEqual(['u-kira']);
  expect(within(rows('Открытые')[0] ?? document.body).queryByText('не прочитано')).toBeNull();

  if (!resolved) throw new Error('resolved tab expected');
  await userEvent.click(resolved);
  await waitFor(() => expect(rows('Решённые')).toHaveLength(1));
  expect(calls.some((call) => call.url.searchParams.get('status') === 'resolved')).toBe(true);
  expect(await conversation('Лев')).toBeTruthy();
  expect(screen.getByText(/^Решено/)).toBeTruthy();
});

test('the conversation shows the person, VoiceRoom answers with the staff name, notes and the account link', async () => {
  routes();
  const onOpenAccount = vi.fn();
  renderAsStaff(SupportPage, { props: { onUnread: vi.fn(), onOpenAccount } }, 'superadmin');
  const region = await conversation('Кира');
  const timeline = within(region).getByRole('list', { name: 'Переписка' });
  expect(within(timeline).getByText('текст m1')).toBeTruthy();
  expect(within(timeline).getByText('VoiceRoom')).toBeTruthy();
  expect(within(timeline).getByRole('img', { name: 'Официальный аккаунт VoiceRoom' })).toBeTruthy();
  // VoiceRoom's own kit avatar (its image loads in a browser; here its initial shows).
  expect(within(timeline).getByText('V')).toBeTruthy();
  expect(within(timeline).getByText(/ответил Root/)).toBeTruthy();
  const callout = within(timeline).getByRole('note');
  expect(within(callout).getByText('Заметка для команды')).toBeTruthy();
  expect(within(callout).getByText('Теряется устройство вывода')).toBeTruthy();
  // Notes sit between messages by time.
  const items = within(timeline).getAllByRole('listitem');
  expect(items.map((item) => (item.textContent?.includes('Заметка') ? 'note' : 'message'))).toEqual([
    'message',
    'note',
    'message'
  ]);
  await userEvent.click(within(region).getByRole('button', { name: /открыть аккаунт/ }));
  expect(onOpenAccount).toHaveBeenCalledWith('u-kira');
});

test('a reply goes out as VoiceRoom, a note stays with the team', async () => {
  const calls = routes({
    'POST /api/admin/support/threads/u-kira/reply': (_url, body) => ({
      body: {
        ok: true,
        message: message('m3', {
          fromPerson: false,
          body: JSON.stringify(body),
          createdAt: AT + 300_000,
          staffName: 'Сотрудник'
        })
      }
    }),
    'POST /api/admin/support/threads/u-kira/notes': {
      body: { ok: true, note: note('n2', 'Завёл задачу', AT + 400_000) }
    }
  });
  renderAsStaff(SupportPage, { props: { onUnread: vi.fn(), onOpenAccount: vi.fn() } }, 'superadmin');
  const region = await conversation('Кира');
  const modes = within(region).getByRole('radiogroup', { name: 'Что отправить' });
  expect(within(modes).getByRole('radio', { name: 'Ответ от VoiceRoom' }).getAttribute('aria-checked')).toBe('true');
  const send = within(region).getByRole('button', { name: 'Отправить' });
  expect(send.hasAttribute('disabled')).toBe(true);
  await userEvent.type(within(region).getByRole('textbox', { name: 'Ответ' }), 'Починили');
  await userEvent.click(send);
  await waitFor(() => expect(within(region).getByText('{"text":"Починили"}')).toBeTruthy());
  const replyCall = calls.find((call) => call.url.pathname.endsWith('/reply'));
  expect(replyCall?.body).toEqual({ text: 'Починили' });
  expect(replyCall?.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);

  await userEvent.click(within(modes).getByRole('radio', { name: 'Заметка для команды' }));
  await userEvent.type(within(region).getByRole('textbox', { name: 'Заметка' }), 'Завёл задачу');
  await userEvent.click(within(region).getByRole('button', { name: 'Сохранить заметку' }));
  await waitFor(() => expect(within(region).getByText('Завёл задачу')).toBeTruthy());
  expect(calls.find((call) => call.url.pathname.endsWith('/notes'))?.body).toEqual({ text: 'Завёл задачу' });
  expect(within(region).getAllByRole('note')).toHaveLength(2);
});

test('a refused answer shows its reason in place; a retry of it carries the same key', async () => {
  let attempts = 0;
  const calls = routes({
    'POST /api/admin/support/threads/u-kira/reply': () => {
      attempts += 1;
      return attempts === 1
        ? { status: 409, body: { ok: false, error: 'gone', code: 'support_conversation_deleted' } }
        : { status: 403, body: { ok: false, error: 'gone', code: 'account_deleted' } };
    }
  });
  renderAsStaff(SupportPage, { props: { onUnread: vi.fn(), onOpenAccount: vi.fn() } }, 'superadmin');
  const region = await conversation('Кира');
  await userEvent.type(within(region).getByRole('textbox', { name: 'Ответ' }), 'Ау');
  await userEvent.click(within(region).getByRole('button', { name: 'Отправить' }));
  expect((await within(region).findByRole('alert')).textContent).toContain('Человек удалил переписку');
  await userEvent.click(within(region).getByRole('button', { name: 'Отправить' }));
  await waitFor(() =>
    expect(within(region).getByRole('alert').textContent).toContain('Аккаунт удалён или заблокирован, ответить нельзя')
  );
  const keys = calls
    .filter((call) => call.url.pathname.endsWith('/reply'))
    .map((call) => call.headers.get('Idempotency-Key'));
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
});

test('resolving the shown conversation opens it first and moves it to «Решённые»', async () => {
  let resolvedYet = false;
  const calls = routes({
    'POST /api/admin/support/threads/u-kira/resolve': () => {
      resolvedYet = true;
      return { body: { ok: true, status: 'resolved', resolvedAt: AT + 500_000 } };
    },
    'GET /api/admin/support/threads': () => ({
      body: resolvedYet
        ? listOf([summary('u-sergey', 'Сергей')], { open: 1, resolved: 2 }, 0)
        : listOf([summary('u-kira', 'Кира', { unread: true })], { open: 1, resolved: 1 })
    })
  });
  renderAsStaff(SupportPage, { props: { onUnread: vi.fn(), onOpenAccount: vi.fn() } }, 'superadmin');
  const region = await conversation('Кира');
  await userEvent.click(within(region).getByRole('button', { name: 'Отметить решённым' }));
  await waitFor(() => expect(calls.some((call) => call.url.pathname.endsWith('/resolve'))).toBe(true));
  await waitFor(() => expect(within(rows('Открытые')[0] ?? document.body).getByText('Сергей')).toBeTruthy());
  const tab = within(screen.getByRole('tablist', { name: 'Обращения по статусу' })).getAllByRole('tab')[1];
  expect(tab?.textContent).toContain('2');
  // It was loaded afresh and marked read before the resolve.
  const order = calls.map((call) => `${call.method} ${call.url.pathname}`);
  const resolveAt = order.indexOf('POST /api/admin/support/threads/u-kira/resolve');
  expect(order.slice(0, resolveAt)).toContain('POST /api/admin/support/threads/u-kira/read');
});

test('resolving the shown conversation stops when a fresh load brings a new message from the person', async () => {
  let loads = 0;
  const calls = routes({
    'GET /api/admin/support/threads/u-kira': () => {
      loads += 1;
      const messages =
        loads === 1 ? [message('m1')] : [message('m1'), message('m9', { body: 'И ещё', createdAt: AT + 900_000 })];
      return { body: threadOf('u-kira', 'Кира', { messages }) };
    }
  });
  renderAsStaff(SupportPage, { props: { onUnread: vi.fn(), onOpenAccount: vi.fn() } }, 'superadmin');
  const region = await conversation('Кира');
  await userEvent.click(within(region).getByRole('button', { name: 'Отметить решённым' }));
  expect((await within(region).findByRole('alert')).textContent).toContain('Человек написал снова, обновите переписку');
  expect(within(region).getByText('И ещё')).toBeTruthy();
  expect(calls.some((call) => call.url.pathname.endsWith('/resolve'))).toBe(false);
});

test('a resolve refused over a new message says so and loads the conversation again', async () => {
  let wroteAgain = false;
  const calls = routes({
    'GET /api/admin/support/threads/u-kira': () => {
      const messages = wroteAgain
        ? [message('m1'), message('m9', { body: 'Снова я', createdAt: AT + 900_000 })]
        : [message('m1')];
      return { body: threadOf('u-kira', 'Кира', { messages }) };
    },
    'POST /api/admin/support/threads/u-kira/resolve': {
      status: 409,
      body: { ok: false, error: 'changed', code: 'support_thread_changed' }
    }
  });
  renderAsStaff(SupportPage, { props: { onUnread: vi.fn(), onOpenAccount: vi.fn() } }, 'superadmin');
  const region = await conversation('Кира');
  // Opened by the staff member, so the resolve goes straight out.
  await userEvent.click(rows('Открытые')[0] ?? document.body);
  await waitFor(() => expect(reads(calls)).toEqual(['u-kira']));
  wroteAgain = true;
  await userEvent.click(within(region).getByRole('button', { name: 'Отметить решённым' }));
  expect((await within(region).findByRole('alert')).textContent).toContain('Человек написал снова, обновите переписку');
  await waitFor(() => expect(within(region).getByText('Снова я')).toBeTruthy());
  // The new message arrived in the open conversation: it is marked read.
  await waitFor(() => expect(reads(calls)).toEqual(['u-kira', 'u-kira']));
});

test('the minute refresh never marks read on its own; an opened conversation is read again only for a new message', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let fresh = false;
  const calls = routes({
    'GET /api/admin/support/threads/u-kira': () => ({
      body: threadOf('u-kira', 'Кира', {
        messages: fresh ? [message('m1'), message('m5', { body: 'Новое', createdAt: AT + 600_000 })] : [message('m1')]
      })
    })
  });
  renderAsStaff(SupportPage, { props: { onUnread: vi.fn(), onOpenAccount: vi.fn() } }, 'superadmin');
  await conversation('Кира');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(calls.filter((call) => call.url.pathname === '/api/admin/support/threads/u-kira').length).toBeGreaterThan(1);
  expect(reads(calls)).toEqual([]);

  // Opened: read once; a refresh with nothing new does not read again.
  await userEvent.click(rows('Открытые')[0] ?? document.body);
  await waitFor(() => expect(reads(calls)).toEqual(['u-kira']));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(reads(calls)).toEqual(['u-kira']);
  fresh = true;
  await vi.advanceTimersByTimeAsync(60_000);
  await waitFor(() => expect(reads(calls)).toEqual(['u-kira', 'u-kira']));
});

test('opening a conversation in a hidden page marks nothing; another one is read once it loads', async () => {
  const calls = routes();
  renderAsStaff(SupportPage, { props: { onUnread: vi.fn(), onOpenAccount: vi.fn() } }, 'superadmin');
  await conversation('Кира');
  setVisibility('hidden');
  await userEvent.click(rows('Открытые')[1] ?? document.body);
  await conversation('Сергей');
  expect(reads(calls)).toEqual([]);
  setVisibility('visible');
  await userEvent.click(rows('Открытые')[0] ?? document.body);
  await conversation('Кира');
  await waitFor(() => expect(reads(calls)).toEqual(['u-kira']));
});

test('a failed mark-read keeps the conversation and tries again on the next open', async () => {
  let failing = true;
  const calls = routes({
    'POST /api/admin/support/threads/u-kira/read': () =>
      failing
        ? { status: 500, body: { ok: false, error: 'boom', code: 'internal_error' } }
        : { body: { ok: true, openUnread: 0 } }
  });
  const onUnread = vi.fn();
  renderAsStaff(SupportPage, { props: { onUnread, onOpenAccount: vi.fn() } }, 'superadmin');
  const region = await conversation('Кира');
  await userEvent.click(rows('Открытые')[0] ?? document.body);
  await waitFor(() => expect(reads(calls)).toEqual(['u-kira']));
  expect(within(region).getByText('текст m1')).toBeTruthy();
  expect(onUnread).toHaveBeenLastCalledWith(1);
  failing = false;
  await userEvent.click(rows('Открытые')[0] ?? document.body);
  await waitFor(() => expect(onUnread).toHaveBeenLastCalledWith(0));
});

test('a blocked or deleted account leaves only notes, with the reason in place', async () => {
  routes({
    'GET /api/admin/support/threads/u-kira': { body: threadOf('u-kira', 'Кира', { personState: 'blocked' }) },
    'GET /api/admin/support/threads/u-sergey': { body: threadOf('u-sergey', 'Сергей', { personState: 'deleted' }) }
  });
  renderAsStaff(SupportPage, { props: { onUnread: vi.fn(), onOpenAccount: vi.fn() } }, 'superadmin');
  const region = await conversation('Кира');
  expect(within(region).getByText('Аккаунт заблокирован')).toBeTruthy();
  expect(within(region).getByText('Ответить от VoiceRoom нельзя, заметки для команды остаются.')).toBeTruthy();
  const modes = within(region).getByRole('radiogroup', { name: 'Что отправить' });
  expect(within(modes).getByRole('radio', { name: 'Ответ от VoiceRoom' }).hasAttribute('disabled')).toBe(true);
  expect(within(region).getByRole('button', { name: 'Сохранить заметку' })).toBeTruthy();
  await userEvent.click(rows('Открытые')[1] ?? document.body);
  const deleted = await conversation('Сергей');
  expect(within(deleted).getByText('Аккаунт удалён')).toBeTruthy();
});

test('after the person deleted the conversation only notes can be added', async () => {
  routes({
    'GET /api/admin/support/threads': {
      body: listOf([summary('u-kira', 'Кира', { lastMessage: null })], { open: 1, resolved: 0 }, 0)
    },
    'GET /api/admin/support/threads/u-kira': {
      body: threadOf('u-kira', 'Кира', { conversationDeleted: true, messages: [] })
    }
  });
  renderAsStaff(SupportPage, { props: { onUnread: vi.fn(), onOpenAccount: vi.fn() } }, 'superadmin');
  const region = await conversation('Кира');
  expect(within(region).getByText('Человек удалил переписку')).toBeTruthy();
  expect(within(rows('Открытые')[0] ?? document.body).getByText('Человек удалил переписку')).toBeTruthy();
  const modes = within(region).getByRole('radiogroup', { name: 'Что отправить' });
  expect(within(modes).getByRole('radio', { name: 'Ответ от VoiceRoom' }).hasAttribute('disabled')).toBe(true);
  expect(within(modes).getByRole('radio', { name: 'Заметка для команды' }).getAttribute('aria-checked')).toBe('true');
  expect(within(region).getByRole('button', { name: 'Сохранить заметку' })).toBeTruthy();
  expect(within(region).getByText('Теряется устройство вывода')).toBeTruthy();
});

test('an empty inbox and a failing list say so; the list is asked again every minute', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let calls = 0;
  stubApi({
    'GET /api/admin/support/threads': () => {
      calls += 1;
      return calls === 1
        ? { status: 500, body: { ok: false, error: 'boom', code: 'internal_error' } }
        : { body: listOf([], { open: 0, resolved: 0 }, 0) };
    }
  });
  renderAsStaff(SupportPage, { props: { onUnread: vi.fn(), onOpenAccount: vi.fn() } }, 'superadmin');
  expect(await screen.findByText('Не удалось загрузить обращения')).toBeTruthy();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(await screen.findByText('Открытых обращений нет')).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
});

test('the «Поддержка» menu entry and its badge show only for staff who may answer', () => {
  const navigation = (role: 'admin' | 'superadmin') =>
    renderWithApp(SidebarNavigation, {
      props: { tabs: allowedTabs(ROLE_PERMISSIONS[role]), current: 'overview', openReports: 0, supportUnread: 2 }
    });
  navigation('admin');
  expect(screen.queryByRole('link', { name: /Поддержка/ })).toBeNull();
  cleanup();
  navigation('superadmin');
  const entry = screen.getByRole('link', { name: /Поддержка/ });
  expect(within(entry).getByLabelText('непрочитанных: 2')).toBeTruthy();
});

test('support displays a downloadable diagnostics row next to ordinary images', async () => {
  const name = 'voiceroom-diagnostics-2026-11-28-1421.txt';
  const url = '/api/admin/support/attachments/diagnostic/file';
  routes({
    'GET /api/admin/support/threads/u-kira': {
      body: threadOf('u-kira', 'Кира', {
        messages: [
          message('with-attachments', {
            attachments: [
              {
                id: 'diagnostic',
                kind: 'diagnostics',
                mimeType: 'text/plain',
                name,
                bytes: 18432,
                url,
                width: null,
                height: null
              },
              {
                id: 'photo',
                mimeType: 'image/webp',
                url: '/preview',
                width: 24,
                height: 24
              },
              {
                id: 'not-ready',
                kind: 'diagnostics',
                mimeType: 'text/plain',
                name: null,
                bytes: null,
                url: null,
                width: null,
                height: null
              }
            ]
          })
        ]
      })
    }
  });
  renderAsStaff(SupportPage, {}, 'superadmin');
  expect(await screen.findByText(name)).toBeTruthy();
  expect(screen.getByText('Диагностика · 18 КБ')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Скачать файл' }).getAttribute('href')).toBe(url);
  expect(screen.getByRole('img', { name: 'Изображение из переписки' }).getAttribute('src')).toBe('/preview');
});
