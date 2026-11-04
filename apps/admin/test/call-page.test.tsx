// A call's own page: who was in it and how each one's voice went, what that
// looks like, what went on and the answers about it; a call going on refreshes
// itself; its addresses; and what the persistent rooms, a folding section and
// the reading of a voice do on their own.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type {
  CallEvent,
  RoomCall,
  RoomStay,
  StaticRoomRow,
  StaticRooms as StaticRoomsPage,
  VoiceMinute
} from '@voice-room/shared/contracts/admin';
import type { RoomCallDetail } from '@voice-room/shared/contracts/feedback';
import { cpuConclusion } from '../src/pages/AccountPanel.tsx';
import { delayOf, heardSummary, verdictOf, worstOf } from '../src/pages/call/verdict.ts';
import { CallPage } from '../src/pages/CallPage.tsx';
import { FIRST_STATIC_VIEW, StaticRooms } from '../src/pages/rooms/StaticRooms.tsx';
import { QualityBar, qualityShort } from '../src/pages/rooms/QualityBar.tsx';
import { locationFromPath, pathOf } from '../src/tabs.ts';
import { Section } from '../src/ui/Section.tsx';
import { renderAs, stubApi } from './helpers/harness.tsx';

const MINUTE = 60_000;
const START = Date.parse('2026-11-03T17:00:00Z');

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const minute = (offset: number, overrides: Partial<VoiceMinute> = {}): VoiceMinute => ({
  at: START + offset * MINUTE,
  level: 'good',
  polls: { good: 20, unstable: 0, bad: 0 },
  heard: null,
  heardBy: null,
  uplinkLossPct: 0.2,
  rttMs: 40,
  jitterBufferMs: 30,
  transport: 'udp',
  ...overrides
});

const stay = (id: string, overrides: Partial<RoomStay> = {}): RoomStay => ({
  id,
  roomId: 'raid',
  roomName: 'Рейд',
  isStatic: true,
  account: null,
  guestName: null,
  guestId: null,
  client: null,
  os: null,
  browser: null,
  ipKey: null,
  location: null,
  joinedAt: START,
  leftAt: START + 60 * MINUTE,
  network: [],
  ...overrides
});

const account = (id: string, displayName: string) => ({
  id,
  login: id,
  displayName,
  avatarUrl: null,
  avatarColorKey: 'blue',
  avatarAccent: null
});

const roomCall = (stays: RoomStay[], overrides: Partial<RoomCall> = {}): RoomCall => ({
  id: 'call-1',
  roomId: 'raid',
  roomName: 'Рейд',
  isStatic: true,
  startedAt: START,
  endedAt: START + 60 * MINUTE,
  stays,
  ...overrides
});

const handlers = () => ({ onBack: vi.fn(), onOpenAccount: vi.fn(), onOpenRoomHistory: vi.fn() });

const overloaded = stay('s-artem', {
  account: account('artem', 'Артём'),
  ipKey: 'same-address',
  minutes: [
    minute(0, {
      level: 'bad',
      polls: { good: 0, unstable: 0, bad: 20 },
      cpuAppPct: 30,
      cpuSystemPct: 97,
      cpuPressure: 'critical',
      heardBy: { concealedPct: 20, gapsPerMin: 8 }
    }),
    minute(1)
  ]
});
const guest = stay('s-kostya', {
  guestName: 'Костя',
  ipKey: 'same-address',
  joinedAt: START + 30 * MINUTE,
  minutes: [minute(30, { rttMs: 200, uplinkLossPct: 9, level: 'bad', polls: { good: 0, unstable: 0, bad: 20 } })]
});
const events: CallEvent[] = [
  { at: START, kind: 'join', stayId: 's-artem' },
  { at: START + MINUTE, kind: 'screen_on', stayId: 's-artem' },
  { at: START + 2 * MINUTE, kind: 'cpu_critical', stayId: 's-artem' },
  { at: START + 30 * MINUTE, kind: 'network', stayId: 's-kostya', detail: 'bad' }
];
const detail: RoomCallDetail = {
  ok: true,
  call: roomCall([overloaded, guest]),
  owner: account('artem', 'Артём'),
  events,
  feedback: [
    {
      id: 'f1',
      rating: 'bad',
      tags: ['delay'],
      comment: 'Звук заикался',
      createdAt: START + 61 * MINUTE,
      author: { userId: 'artem', login: 'artem', displayName: 'Артём' },
      roomId: 'raid',
      roomName: 'Рейд',
      durationS: 3600,
      peers: 2,
      platform: 'browser',
      quality: null
    }
  ]
};

test('a finished call shows its numbers, what each one looked like, what went on and the answers', async () => {
  const calls = stubApi({ 'GET /api/admin/rooms/calls/call-1': { body: detail } });
  const on = handlers();
  renderAs(<CallPage call={{ kind: 'finished', callId: 'call-1' }} {...on} />);

  expect(await screen.findByRole('heading', { level: 2, name: 'Рейд' })).toBeTruthy();
  expect(screen.getByText('связь хуже нормы')).toBeTruthy();
  expect(screen.getAllByText('@artem')).toHaveLength(2);
  const numbers = screen.getByRole('list', { name: 'Цифры звонка' });
  // Two of three minutes were bad.
  expect(within(numbers).getByText('67 %')).toBeTruthy();
  expect(within(numbers).getByText('2 из 3 минут участников')).toBeTruthy();
  expect(within(numbers).getByText('1 аккаунт · 1 гость')).toBeTruthy();
  expect(within(numbers).getByText('хуже всех — Костя, 200 мс')).toBeTruthy();

  // The first person is shown first: their bad minute falls on the overload with a normal network.
  expect(screen.getByText('Похоже, перегружен процессор')).toBeTruthy();
  expect(screen.getByRole('img', { name: /^Задержка \(RTT\): в среднем 40 мс, пик 40 мс/ })).toBeTruthy();

  // A row picks another person.
  const row = screen.getByRole('button', { name: /Костя/ });
  expect(row.getAttribute('aria-pressed')).toBe('false');
  await userEvent.click(row);
  expect(row.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('heading', { level: 3, name: 'Связь по минутам: Костя' })).toBeTruthy();
  expect(screen.getByText('Плохая сеть')).toBeTruthy();

  // One address under two people is pointed out, and the address itself never is.
  expect(screen.getByText(/Одинаковый ключ адреса — один и тот же IP: Артём, Костя/)).toBeTruthy();

  const feed = screen.getByRole('region', { name: 'Что происходило' });
  expect(within(feed).getByText('Артём — показ экрана включён')).toBeTruthy();
  expect(within(feed).getByText('Артём — система загружена: critical')).toBeTruthy();
  expect(within(feed).getByText('Звонок завершён')).toBeTruthy();
  expect(within(feed).getByText('Костя — плохая связь')).toBeTruthy();

  const answers = screen.getByRole('region', { name: 'Отзывы после звонка' });
  expect(within(answers).getByText('«Звук заикался»')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Отзывы · 1' }).getAttribute('href')).toBe('#feedback');

  await userEvent.click(screen.getByRole('button', { name: 'Все звонки комнаты' }));
  expect(on.onOpenRoomHistory).toHaveBeenCalledWith({ id: 'raid', name: 'Рейд' });
  await userEvent.click(screen.getByRole('button', { name: 'Назад к комнатам' }));
  expect(on.onBack).toHaveBeenCalledOnce();
  // It does not change, so it is asked for once.
  expect(calls).toHaveLength(1);
});

test('someone who may not read the answers is not offered them', async () => {
  stubApi({ 'GET /api/admin/rooms/calls/call-1': { body: { ok: true, call: detail.call, events } } });
  renderAs(<CallPage call={{ kind: 'finished', callId: 'call-1' }} {...handlers()} />, 'moderator');
  await screen.findByRole('heading', { level: 2, name: 'Рейд' });
  expect(screen.queryByRole('region', { name: 'Отзывы после звонка' })).toBeNull();
  expect(screen.queryByRole('link', { name: /^Отзывы/ })).toBeNull();
});

test('a call going on asks again every few seconds and stops when it leaves', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const calls = stubApi({ 'GET /api/admin/rooms/live/raid': { body: detail } });
  const view = renderAs(<CallPage call={{ kind: 'live', roomId: 'raid' }} {...handlers()} />);
  await screen.findByRole('heading', { level: 2, name: 'Рейд' });
  expect(screen.getByText('идёт сейчас')).toBeTruthy();
  expect(calls).toHaveLength(1);
  vi.advanceTimersByTime(5000);
  await waitFor(() => expect(calls).toHaveLength(2));
  view.unmount();
  vi.advanceTimersByTime(20_000);
  expect(calls).toHaveLength(2);
});

test('a call that ends while it is watched keeps what was shown and stops asking', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  let over = false;
  const calls = stubApi({
    'GET /api/admin/rooms/live/raid': () =>
      over ? { status: 404, body: { ok: false, error: 'Call not found', code: 'call_not_found' } } : { body: detail }
  });
  renderAs(<CallPage call={{ kind: 'live', roomId: 'raid' }} {...handlers()} />);
  await screen.findByText('идёт сейчас');

  over = true;
  vi.advanceTimersByTime(5000);
  expect(await screen.findByText('звонок закончился')).toBeTruthy();
  expect(screen.queryByText('идёт сейчас')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('heading', { level: 2, name: 'Рейд' })).toBeTruthy();

  const asked = calls.length;
  vi.advanceTimersByTime(20_000);
  expect(calls).toHaveLength(asked);
});

test('a call that has ended or never was says so and can go back', async () => {
  stubApi({
    'GET /api/admin/rooms/live/raid': {
      status: 404,
      body: { ok: false, error: 'Call not found', code: 'call_not_found' }
    }
  });
  const on = handlers();
  renderAs(<CallPage call={{ kind: 'live', roomId: 'raid' }} {...on} />);
  expect(await screen.findByText('Звонок не найден или уже закончился')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Назад к комнатам' }));
  expect(on.onBack).toHaveBeenCalledOnce();
});

test('a call has its own address under the rooms section', () => {
  expect(locationFromPath('/rooms/calls/a%20b')).toEqual({
    tab: 'rooms',
    accountId: null,
    call: { kind: 'finished', callId: 'a b' }
  });
  expect(locationFromPath('/rooms/live/raid/')).toEqual({
    tab: 'rooms',
    accountId: null,
    call: { kind: 'live', roomId: 'raid' }
  });
  expect(locationFromPath('/rooms/calls/%E0')).toEqual({ tab: 'overview', accountId: null });
  expect(locationFromPath('/rooms')).toEqual({ tab: 'rooms', accountId: null });
  expect(pathOf({ tab: 'rooms', accountId: null, call: { kind: 'finished', callId: 'a b' } })).toBe(
    '/rooms/calls/a%20b'
  );
  expect(pathOf({ tab: 'rooms', accountId: null, call: { kind: 'live', roomId: 'raid' } })).toBe('/rooms/live/raid');
});

test('a voice is read from its minutes, and blames only what the numbers show', () => {
  const bad = { level: 'bad' as const, polls: { good: 0, unstable: 0, bad: 20 } };
  expect(verdictOf([]).title).toBe('Нет данных о связи');
  expect(verdictOf([minute(0, { level: null })]).title).toBe('Нет данных о связи');
  expect(verdictOf([minute(0), minute(1)]).title).toBe('Голос в порядке');
  expect(verdictOf([minute(0, { ...bad, cpuPressure: 'critical' })]).title).toBe('Похоже, перегружен процессор');
  expect(verdictOf([minute(0, { ...bad, rttMs: 300 })]).title).toBe('Плохая сеть');
  expect(verdictOf([minute(0, { ...bad, uplinkLossPct: 9, cpuPressure: 'critical' })]).title).toBe(
    'Плохая сеть и загруженный процессор'
  );
  expect(verdictOf([minute(0, { ...bad, transport: 'relay' })]).title).toBe('Связь шла через ретранслятор');
  expect(verdictOf([minute(0, bad)]).title).toBe('Были плохие минуты');
});

test('a network is called bad by the same line the room is judged by', () => {
  const unstable = { level: 'unstable' as const, polls: { good: 10, unstable: 10, bad: 0 } };
  // 150 ms is a fine ping for a call: the voice trouble of this minute is not the network's.
  expect(verdictOf([minute(0, { ...unstable, rttMs: 150 })]).title).toBe('Были нестабильные минуты');
  expect(verdictOf([minute(0, { ...unstable, rttMs: 300 })]).title).toBe('Плохая сеть');
});

test('a long delay is named as the cause, from the polls that gave it or from its numbers', () => {
  const unstable = { level: 'unstable' as const, polls: { good: 0, unstable: 20, bad: 0 } };
  const buffered = verdictOf([minute(0, { ...unstable, rttMs: 100, jitterBufferMs: 300 })]);
  expect(buffered.title).toBe('Большая задержка голоса');
  expect(buffered.text).toContain('пинг 100 мс, буфер 300 мс');
  const told = minute(0, { ...unstable, causes: { heard_badly: 2, hears_badly: 0, delay: 18 } });
  expect(verdictOf([told]).title).toBe('Большая задержка голоса');
  // Gaps by far outweigh it, and the numbers do not reach the line either.
  const gaps = minute(0, { ...unstable, causes: { heard_badly: 0, hears_badly: 18, delay: 2 } });
  expect(verdictOf([gaps]).title).toBe('Были нестабильные минуты');
  expect(verdictOf([gaps]).text).toContain('В самом звуке были разрывы');
  expect(delayOf({ rttMs: 100, jitterBufferMs: 300 })).toBe(440);
  expect(delayOf({ rttMs: null, jitterBufferMs: 300 })).toBeNull();
});

test('the causes the server gave outrank a delay worked out from one side of it', () => {
  // A ping and a buffer that add up past the line, and yet no poll blamed the delay.
  const minuteOfGaps = minute(0, {
    level: 'unstable',
    polls: { good: 13, unstable: 7, bad: 0 },
    causes: { heard_badly: 0, hears_badly: 7, delay: 0 },
    rttMs: 290,
    jitterBufferMs: 80
  });
  expect(delayOf(minuteOfGaps)).toBe(410);
  expect(verdictOf([minuteOfGaps]).title).toBe('Были нестабильные минуты');
});

test('a minute one trouble passed through stays good, and the verdict still says it happened', () => {
  const clean = verdictOf([minute(0), minute(1)]);
  expect(clean.title).toBe('Голос в порядке');
  expect(clean.text).toBe('Связь была ровной весь звонок.');
  const passing = verdictOf([minute(0, { polls: { good: 15, unstable: 5, bad: 0 } }), minute(1), minute(2), minute(3)]);
  expect(passing.title).toBe('Голос в порядке');
  expect(passing.tone).toBe('success');
  expect(passing.text).toContain('всего 15 с');
});

test('short troubles that keep coming are not called fine, though no minute was coloured', () => {
  // 300 ms lost every ten seconds: 18 seconds of each minute, under the third that colours one.
  const each = { polls: { good: 14, unstable: 6, bad: 0 } };
  const verdict = verdictOf([minute(0, each), minute(1, each), minute(2, each)]);
  expect(verdict.title).toBe('Были повторяющиеся сбои');
  expect(verdict.tone).toBe('warning');
  expect(verdict.text).toContain('54 с из 180 с');
});

test("a minute's worst is never less than its own number, for speakers too brief to fill a window", () => {
  expect(worstOf({ concealedPct: 4, gapsPerMin: 20, worstConcealedPct: 0, worstGaps: 0 })).toBe(4);
  expect(worstOf({ concealedPct: 0.3, gapsPerMin: 2, worstConcealedPct: 6, worstGaps: 3 })).toBe(6);
  expect(worstOf({ concealedPct: 2, gapsPerMin: 2 })).toBe(2);
  expect(worstOf(null)).toBeNull();
});

test('one side of a voice weighs minutes by their speech and keeps its worst moment', () => {
  const summary = heardSummary([
    { concealedPct: 0.2, gapsPerMin: 2, speechS: 57, worstConcealedPct: 6, worstGaps: 4 },
    { concealedPct: 4, gapsPerMin: 40, speechS: 3, worstConcealedPct: 4, worstGaps: 2 },
    null
  ]);
  // A minute of three seconds does not count as much as one of nearly all speech.
  expect(summary?.concealedPct).toBeCloseTo(0.39, 2);
  expect(summary?.worstConcealedPct).toBe(6);
  expect(summary?.worstGaps).toBe(4);
  expect(heardSummary([null, undefined])).toBeNull();
  // Minutes from before the worst moment was kept read as their own number, and no gaps are made up.
  expect(heardSummary([{ concealedPct: 5, gapsPerMin: 3 }])).toEqual({
    concealedPct: 5,
    worstConcealedPct: 5,
    worstGaps: null
  });
});

test('a computer busy far beyond VoiceRoom is only a hint, and only with bad minutes on top', () => {
  const cpu = { appAvgPct: 20, systemAvgPct: 90, calls: 4, criticalCalls: 3, relievedCalls: 1 };
  expect(cpuConclusion(cpu, 10)).toContain('скорее всего, параллельно запущена игра');
  expect(cpuConclusion(cpu, 0)).not.toContain('игра');
  expect(cpuConclusion({ ...cpu, systemAvgPct: 40 }, 10)).not.toContain('игра');
  expect(cpuConclusion({ ...cpu, criticalCalls: 0 }, 10)).toBe('Перегрузок процессора в звонках не было.');
});

test('the quality bar counts only minutes known and rounds to whole shares', () => {
  render(<QualityBar quality={{ good: 18, unstable: 1, bad: 1 }} />);
  expect(screen.getByRole('img', { name: 'Минуты связи: в порядке 90%, нестабильно 5%, плохо 5%' })).toBeTruthy();
  expect(qualityShort({ good: 18, unstable: 1, bad: 1 })).toBe('5% плохих минут');
  expect(qualityShort({ good: 19, unstable: 1, bad: 0 })).toBe('5% нестабильных');
  expect(qualityShort({ good: 20, unstable: 0, bad: 0 })).toBe('связь в порядке');
});

test('a section folds under its heading, keeps what it sums up, and comes back as it was left', async () => {
  const body = () => screen.queryByText('Внутри');
  const section = (defaultOpen = true) => (
    <Section page="test" id="one" title="Заголовок" defaultOpen={defaultOpen} summary={<span>Итог</span>}>
      <p>Внутри</p>
    </Section>
  );
  const view = render(section());
  const toggle = screen.getByRole('button', { name: 'Заголовок' });
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(document.getElementById(toggle.getAttribute('aria-controls') ?? '')?.hidden).toBe(false);

  await userEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(body()?.closest('[hidden]')).toBeTruthy();
  expect(screen.getByText('Итог')).toBeTruthy();
  expect(window.localStorage.getItem('vr-admin-section-test-one')).toBe('closed');

  view.unmount();
  render(section());
  expect(screen.getByRole('button', { name: 'Заголовок' }).getAttribute('aria-expanded')).toBe('false');
  cleanup();

  window.localStorage.clear();
  render(section(false));
  expect(screen.getByRole('button', { name: 'Заголовок' }).getAttribute('aria-expanded')).toBe('false');
});

test('a section still folds where the browser keeps nothing', async () => {
  const failing = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  const writing = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  render(
    <Section page="test" id="two" title="Заголовок">
      <p>Внутри</p>
    </Section>
  );
  const toggle = screen.getByRole('button', { name: 'Заголовок' });
  await userEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  failing.mockRestore();
  writing.mockRestore();
});

const staticRoom = (overrides: Partial<StaticRoomRow> = {}): StaticRoomRow => ({
  id: 'raid-7q2',
  name: 'Рейд',
  avatarUrl: null,
  owner: account('artem', 'Артём'),
  members: 12,
  createdAt: START - 30 * 24 * 60 * MINUTE,
  calls30d: 9,
  voiceMinutes30d: 600,
  lastCallAt: START - 60 * MINUTE,
  live: false,
  quality30d: { good: 90, unstable: 8, bad: 2 },
  ...overrides
});

const staticPage = (rooms: StaticRoomRow[], total = rooms.length): StaticRoomsPage => ({
  ok: true,
  rooms,
  total,
  page: 1,
  pageSize: 50,
  counts: { all: 38, active: 21, trouble: 3, quiet: 6 }
});

function renderStatic(page: StaticRoomsPage) {
  const on = { onChange: vi.fn(), onRetry: vi.fn(), onShowHistory: vi.fn() };
  render(<StaticRooms page={page} failure={null} busy={false} view={FIRST_STATIC_VIEW} now={START} {...on} />);
  return on;
}

test('the persistent rooms show their numbers, and the controls ask for another view', async () => {
  const on = renderStatic(
    staticPage(
      [
        staticRoom(),
        staticRoom({ id: 'lobby', name: 'Лобби', live: true }),
        staticRoom({ id: 'empty', name: 'Тишина', lastCallAt: null, quality30d: null })
      ],
      120
    )
  );
  const table = screen.getByRole('table', { name: 'Постоянные комнаты' });
  expect(within(table).getAllByText('@artem')).toHaveLength(3);
  expect(within(table).getByText('в звонке')).toBeTruthy();
  expect(within(table).getByText('сейчас')).toBeTruthy();
  expect(within(table).getByText('пустует')).toBeTruthy();
  expect(within(table).getByText('нет звонков')).toBeTruthy();
  expect(
    within(table).getAllByRole('img', { name: 'Минуты связи: в порядке 90%, нестабильно 8%, плохо 2%' })
  ).toHaveLength(2);
  expect(screen.getByText(/Показано 1–50 из 120/)).toBeTruthy();

  await userEvent.click(screen.getByRole('radio', { name: 'Со связью хуже нормы 3' }));
  expect(on.onChange).toHaveBeenLastCalledWith({ ...FIRST_STATIC_VIEW, filter: 'trouble' });
  await userEvent.selectOptions(screen.getByRole('combobox'), 'По часам в войсе');
  expect(on.onChange).toHaveBeenLastCalledWith({ ...FIRST_STATIC_VIEW, sort: 'voice' });
  await userEvent.click(screen.getByRole('button', { name: 'Дальше' }));
  expect(on.onChange).toHaveBeenLastCalledWith({ ...FIRST_STATIC_VIEW, page: 2 });
  await userEvent.click(screen.getByRole('button', { name: 'История звонков: Лобби' }));
  expect(on.onShowHistory).toHaveBeenCalledWith(expect.objectContaining({ id: 'lobby' }));
  await userEvent.type(screen.getByRole('searchbox', { name: 'Поиск комнаты' }), 'bob');
  await waitFor(() => expect(on.onChange).toHaveBeenLastCalledWith({ ...FIRST_STATIC_VIEW, q: 'bob' }));
});

test('nothing found says so', () => {
  renderStatic(staticPage([]));
  expect(screen.getByText('Таких комнат нет')).toBeTruthy();
});
