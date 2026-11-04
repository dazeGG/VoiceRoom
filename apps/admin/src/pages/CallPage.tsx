// One call in full, finished or going on: who was in it and when, how each
// one's voice went minute by minute and what that looks like, what went on, and
// the answers given about it. The numbers come from its stays; the reading of
// them (verdict.ts) is the panel's own.

import { ArrowLeft, History, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useState } from 'react';
import type { CallEvent, RoomCall, RoomStay, VoiceMinute } from '@voice-room/shared/contracts/admin';
import type { AdminCallFeedbackEntry } from '@voice-room/shared/contracts/feedback';
import { CALL_FEEDBACK_TAG_LABELS } from '@voice-room/shared/feedback-labels';
import { CONCEALMENT_THRESHOLDS } from '@voice-room/shared/network-quality';
import { fetchLiveCall, fetchRoomCall } from '../api/admin.ts';
import { ApiError } from '../api/client.ts';
import {
  formatClock,
  formatCount,
  formatDayHeading,
  formatDuration,
  formatMinutes,
  formatMs,
  formatPeople,
  formatPercent,
  plural
} from '../format.ts';
import { RefreshReport } from '../frame.tsx';
import { useAdminResource } from '../load-state.ts';
import { Notice } from '../Notice.tsx';
import type { CallRef } from '../tabs.ts';
import { Avatar, Button, Empty, Pill, RoomAvatar, Stat, Stats } from '../ui/index.tsx';
import { MinuteChart } from './call/MinuteChart.tsx';
import {
  CONCEALED_LIMIT_PCT,
  DELAY_LIMIT_MS,
  LOSS_LIMIT_PCT,
  RTT_LIMIT_MS,
  delayOf,
  heardSummary,
  seriesOf,
  verdictOf,
  worstOf,
  type HeardSummary
} from './call/verdict.ts';
import { CallPeople } from './rooms/CallPeople.tsx';
import { NetworkLegend, NetworkSpan } from './rooms/network-bar.tsx';
import { qualityOfMinutes, qualityShares } from './rooms/QualityBar.tsx';
import { peopleOf, type CallPerson } from './rooms/room-bits.tsx';
import './CallPage.css';

const LIVE_REFRESH_MS = 5000;
const TROUBLE_PCT = 5;
const TICK_MS = 30 * 60_000;
const PEOPLE_COLUMNS = 'minmax(180px, 1fr) minmax(300px, 2.4fr) 80px minmax(280px, 1.4fr)';

const personName = (person: Pick<CallPerson, 'account' | 'guestName'>) =>
  person.account ? person.account.displayName || person.account.login : (person.guestName ?? 'Гость');

const minutesOfPerson = (person: CallPerson): VoiceMinute[] =>
  person.spans.flatMap((span) => span.minutes).sort((a, b) => a.at - b.at);

/** The most people in the call at once, and when that first happened. */
function peakOf(call: RoomCall): { people: number; at: number } {
  const moves = call.stays
    .flatMap((stay) => [
      { at: stay.joinedAt, delta: 1 },
      { at: stay.leftAt, delta: -1 }
    ])
    .sort((a, b) => a.at - b.at || a.delta - b.delta);
  let inside = 0;
  let peak = { people: 0, at: call.startedAt };
  for (const { at, delta } of moves) {
    inside += delta;
    if (inside > peak.people) peak = { people: inside, at };
  }
  return peak;
}

/** The moments an axis marks: every half hour on the hour, or the ends of a short call. */
function ticksOf(from: number, to: number): number[] {
  if (to - from < TICK_MS) return [from, to];
  const first = Math.ceil(from / TICK_MS) * TICK_MS;
  const ticks: number[] = [];
  for (let at = first; at <= to; at += TICK_MS) ticks.push(at);
  return ticks;
}

function Axis({ from, to }: { from: number; to: number }) {
  return (
    <span className="call-axis ui-mono" aria-hidden="true">
      {ticksOf(from, to).map((at) => {
        const share = ((at - from) / Math.max(1, to - from)) * 100;
        // A mark at an end stays inside the bar; the others stand centred over their moment.
        const edge = share < 8 ? 'start' : share > 92 ? 'end' : 'middle';
        return (
          <span key={at} data-edge={edge} style={{ left: `${share}%` }}>
            {formatClock(at)}
          </span>
        );
      })}
    </span>
  );
}

/** Those who came from the address another person in the call came from: a key is the same address, never the address itself. */
function sharedAddresses(people: readonly CallPerson[]): Map<string, CallPerson[]> {
  const byKey = new Map<string, CallPerson[]>();
  for (const person of people) {
    const key = person.seat.ipKey;
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), person]);
  }
  return new Map([...byKey].filter(([, sharing]) => sharing.length > 1));
}

const TRANSPORTS: Record<string, string> = { udp: 'UDP', tcp: 'TCP', relay: 'через ретранслятор (TURN)' };

/** How one side of a voice went over the call: its whole share, and its worst moment, which the share waters down. */
function heardFact(
  label: string,
  summary: HeardSummary
): { label: string; value: string; tone?: 'warning' | 'danger' } {
  const { noticeablePct, badPct } = CONCEALMENT_THRESHOLDS;
  const { concealedPct, worstConcealedPct, worstGaps } = summary;
  if (concealedPct < 1 && worstConcealedPct < noticeablePct) return { label, value: 'в порядке' };
  const gaps = worstGaps === null ? '' : `, разрывов до ${formatCount(worstGaps)}`;
  const value = `додумано ${formatPercent(Math.round(concealedPct * 10) / 10)} речи · худшие 15 с: до ${formatPercent(worstConcealedPct)}${gaps}`;
  if (concealedPct >= badPct) return { label, value, tone: 'danger' };
  return concealedPct >= noticeablePct || worstConcealedPct >= noticeablePct
    ? { label, value, tone: 'warning' }
    : { label, value };
}

function Facts({ person, events }: { person: CallPerson; events: readonly CallEvent[] }) {
  const minutes = minutesOfPerson(person);
  const ids = new Set(person.stayIds);
  const own = events.filter((event) => event.stayId !== null && ids.has(event.stayId));
  const spansOf = (on: CallEvent['kind'], off: CallEvent['kind']) =>
    own
      .filter((event) => event.kind === on || event.kind === off)
      .map((event) => `${event.kind === on ? 'с' : 'до'} ${formatClock(event.at)}`)
      .join(', ');
  const heard = heardSummary(minutes.map((minute) => minute.heard));
  const heardBy = heardSummary(minutes.map((minute) => minute.heardBy));
  const rtt = seriesOf(minutes.map((minute) => minute.rttMs));
  const buffer = seriesOf(minutes.map((minute) => minute.jitterBufferMs));
  const delay = seriesOf(minutes.map(delayOf));
  const loss = seriesOf(minutes.map((minute) => minute.uplinkLossPct));
  const app = seriesOf(minutes.map((minute) => minute.cpuAppPct));
  const system = seriesOf(minutes.map((minute) => minute.cpuSystemPct));
  const firstCritical = own.find((event) => event.kind === 'cpu_critical');
  const firstRelief = own.find((event) => event.kind === 'relieved_ns');
  const transport = minutes.at(-1)?.transport ?? null;
  const screen = spansOf('screen_on', 'screen_off');
  const camera = spansOf('camera_on', 'camera_off');
  const facts: { label: string; value: string; tone?: 'warning' | 'danger' }[] = [
    {
      label: 'Был в звонке',
      value: `${person.spans.map((span) => `${formatClock(span.from)}–${formatClock(span.to)}`).join(', ')} · ${formatDuration(person.total)}`
    }
  ];
  const clientLine = [
    person.seat.client === 'desktop_app' ? 'приложение' : person.seat.client ? 'браузер' : '',
    person.seat.os,
    person.seat.browser
  ]
    .filter(Boolean)
    .join(' · ');
  if (clientLine) facts.push({ label: 'Клиент', value: clientLine });
  if (person.seat.location) facts.push({ label: 'Откуда', value: person.seat.location });
  if (transport) facts.push({ label: 'Транспорт', value: TRANSPORTS[transport] ?? transport });
  if (screen) facts.push({ label: 'Показ экрана', value: screen });
  if (camera) facts.push({ label: 'Камера', value: camera });
  if (rtt.avg !== null) {
    facts.push({
      label: 'Средний RTT',
      value: formatMs(Math.round(rtt.avg)),
      ...(rtt.avg >= RTT_LIMIT_MS ? { tone: 'danger' as const } : {})
    });
  }
  if (buffer.avg !== null) facts.push({ label: 'Буфер', value: formatMs(Math.round(buffer.avg)) });
  if (delay.avg !== null) {
    facts.push({
      label: 'Задержка голоса',
      value: `около ${formatMs(Math.round(delay.avg))}`,
      ...(delay.avg >= DELAY_LIMIT_MS ? { tone: 'warning' as const } : {})
    });
  }
  if (loss.avg !== null) {
    facts.push({
      label: 'Потери от него',
      value: `${formatPercent(loss.avg)}${loss.peak === null ? '' : ` · до ${formatPercent(loss.peak)}`}`,
      ...(loss.avg >= LOSS_LIMIT_PCT ? { tone: 'danger' as const } : {})
    });
  }
  if (app.avg !== null || system.avg !== null) {
    facts.push({
      label: 'Процессор',
      value: `VoiceRoom ${formatPercent(app.avg === null ? null : Math.round(app.avg))} · всё ${formatPercent(system.avg === null ? null : Math.round(system.avg))}`,
      ...((system.avg ?? 0) >= 90 ? { tone: 'danger' as const } : {})
    });
  }
  if (firstCritical) {
    facts.push({ label: 'Нагрузка системы', value: `critical с ${formatClock(firstCritical.at)}`, tone: 'danger' });
  }
  if (firstRelief) facts.push({ label: 'Шумодав', value: `облегчённый с ${formatClock(firstRelief.at)}` });
  if (heardBy) facts.push(heardFact('Как его слышали', heardBy));
  if (heard) facts.push(heardFact('Как он слышал', heard));
  return (
    <dl className="call-facts">
      {facts.map((fact) => (
        <div key={fact.label}>
          <dt>{fact.label}</dt>
          <dd data-tone={fact.tone}>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PersonPanel({
  person,
  events,
  onOpenAccount
}: {
  person: CallPerson;
  events: readonly CallEvent[];
  onOpenAccount: (accountId: string) => void;
}) {
  const verdict = verdictOf(minutesOfPerson(person));
  const name = personName(person);
  return (
    <aside className="call-card call-person-panel" aria-label={`Участник: ${name}`}>
      <div className="call-person-head">
        <Avatar
          name={name}
          src={person.account?.avatarUrl ?? null}
          colorKey={person.account?.avatarColorKey ?? ''}
          background={person.account?.avatarAccent ?? null}
          size={40}
        />
        <span className="call-person-title">
          <span className="call-person-name">{name}</span>
          <span className="ui-mono call-person-login">{person.account ? `@${person.account.login}` : 'гость'}</span>
        </span>
        {person.account ? (
          <button type="button" className="ui-text-link" onClick={() => onOpenAccount(person.account?.id ?? '')}>
            Аккаунт
          </button>
        ) : null}
      </div>
      <div className="call-verdict" data-tone={verdict.tone}>
        <span className="call-verdict-title">{verdict.title}</span>
        <span className="call-verdict-text">{verdict.text}</span>
      </div>
      <Facts person={person} events={events} />
    </aside>
  );
}

const EVENT_TONES: Partial<Record<CallEvent['kind'], string>> = {
  screen_on: 'accent',
  camera_on: 'accent',
  cpu_critical: 'danger',
  relieved_ns: 'info'
};

const NETWORK_EVENT_TEXT: Record<string, string> = {
  good: 'связь снова в порядке',
  unstable: 'голос нестабилен',
  bad: 'плохая связь'
};

// Names come in any form and gender is not known, so each line is put without declining or agreeing with one.
function eventText(event: CallEvent, name: string): string {
  switch (event.kind) {
    case 'join':
      return `${name} — в звонке`;
    case 'leave':
      return `${name} — вне звонка`;
    case 'screen_on':
      return `${name} — показ экрана включён`;
    case 'screen_off':
      return `${name} — показ экрана выключен`;
    case 'camera_on':
      return `${name} — камера включена`;
    case 'camera_off':
      return `${name} — камера выключена`;
    case 'cpu_critical':
      return `${name} — система загружена: critical`;
    case 'relieved_ns':
      return `${name} — включён облегчённый шумодав`;
    case 'network':
      return `${name} — ${NETWORK_EVENT_TEXT[event.detail ?? ''] ?? 'связь изменилась'}`;
  }
}

function eventTone(event: CallEvent): string {
  if (event.kind === 'network')
    return event.detail === 'bad' ? 'danger' : event.detail === 'unstable' ? 'warning' : 'plain';
  return EVENT_TONES[event.kind] ?? 'plain';
}

function Events({
  events,
  stays,
  endedAt
}: {
  events: readonly CallEvent[];
  stays: readonly RoomStay[];
  /** The moment it ended; none while it goes on. */
  endedAt: number | null;
}) {
  const nameOf = (stayId: string | null) => {
    const stay = stays.find((one) => one.id === stayId);
    if (!stay) return 'Кто-то';
    return stay.account ? stay.account.displayName || stay.account.login : (stay.guestName ?? 'Гость');
  };
  return (
    <section className="call-card call-card--flush call-pair-wide" aria-labelledby="call-events-title">
      <header className="call-card-head">
        <h3 id="call-events-title">Что происходило</h3>
        <span className="call-note">входы, экран, связь, процессор</span>
      </header>
      {events.length === 0 ? (
        <Empty>Ничего не записано</Empty>
      ) : (
        <ol className="call-events">
          {events.map((event, index) => (
            <li key={`${event.at}-${event.kind}-${event.stayId ?? ''}-${index}`}>
              <span className="call-event-at ui-mono">{formatClock(event.at)}</span>
              <span className="call-event-dot" data-tone={eventTone(event)} aria-hidden="true" />
              <span className="call-event-text">{eventText(event, nameOf(event.stayId))}</span>
            </li>
          ))}
          {endedAt === null ? null : (
            <li>
              <span className="call-event-at ui-mono">{formatClock(endedAt)}</span>
              <span className="call-event-dot" data-tone="plain" aria-hidden="true" />
              <span className="call-event-text">Звонок завершён</span>
            </li>
          )}
        </ol>
      )}
    </section>
  );
}

function feedbackLine(entry: AdminCallFeedbackEntry): string {
  const quality = entry.quality;
  const parts = [formatMinutes(entry.durationS / 60), `собеседников ${formatCount(entry.peers)}`];
  if (quality) {
    const loss = Math.max(quality.inboundLossAvgPct ?? 0, quality.outboundLossAvgPct ?? 0);
    parts.push(`потери ${formatPercent(loss)}`);
    if (quality.appCpuAvgPct !== undefined && quality.appCpuAvgPct !== null) {
      parts.push(
        `процессор: VoiceRoom ${formatPercent(quality.appCpuAvgPct)}${
          quality.systemCpuAvgPct === undefined || quality.systemCpuAvgPct === null
            ? ''
            : ` · всё ${formatPercent(quality.systemCpuAvgPct)}`
        }`
      );
    }
  }
  return parts.join(' · ');
}

function Feedback({ entries }: { entries: readonly AdminCallFeedbackEntry[] }) {
  const bad = entries.filter((entry) => entry.rating === 'bad').length;
  return (
    <section
      id="feedback"
      className="call-card call-card--flush call-pair-narrow"
      aria-labelledby="call-feedback-title"
    >
      <header className="call-card-head">
        <h3 id="call-feedback-title">Отзывы после звонка</h3>
        {bad ? (
          <Pill tone="danger" compact>
            {`${formatCount(bad)} ${plural(bad, ['плохой', 'плохих', 'плохих'])}`}
          </Pill>
        ) : null}
      </header>
      {entries.length === 0 ? (
        <Empty>Отзывов нет</Empty>
      ) : (
        entries.map((entry) => {
          const Icon = entry.rating === 'good' ? ThumbsUp : ThumbsDown;
          return (
            <article key={entry.id} className="call-answer">
              <div className="call-answer-head">
                <span className="call-answer-rating" data-rating={entry.rating}>
                  <Icon size={16} aria-label={entry.rating === 'good' ? 'Хорошо' : 'Плохо'} />
                </span>
                <span className="call-answer-who">
                  {entry.author ? entry.author.displayName || entry.author.login : 'Гость'}
                </span>
                <span className="call-answer-at ui-mono">{formatClock(entry.createdAt)}</span>
              </div>
              {entry.tags.length ? (
                <div className="call-answer-tags">
                  {entry.tags.map((tag) => (
                    <Pill key={tag} compact>
                      {CALL_FEEDBACK_TAG_LABELS[tag]}
                    </Pill>
                  ))}
                </div>
              ) : null}
              {entry.comment ? <p className="call-answer-comment">«{entry.comment}»</p> : null}
              <p className="call-answer-line">{feedbackLine(entry)}</p>
            </article>
          );
        })
      )}
    </section>
  );
}

export function CallPage({
  call: reference,
  onBack,
  onOpenAccount,
  onOpenRoomHistory
}: {
  call: CallRef;
  onBack: () => void;
  onOpenAccount: (accountId: string) => void;
  onOpenRoomHistory: (room: { id: string; name: string | null }) => void;
}) {
  const live = reference.kind === 'live';
  // A call going on ends sooner or later: then its address finds nothing, and there is nothing more to ask.
  const [ended, setEnded] = useState(false);
  const polling = live && !ended;
  const { data, failure, busy, loadedAt, reload } = useAdminResource(
    async () => {
      if (reference.kind === 'finished') return fetchRoomCall(reference.callId);
      try {
        return await fetchLiveCall(reference.roomId);
      } catch (cause) {
        if (cause instanceof ApiError && cause.code === 'call_not_found') setEnded(true);
        throw cause;
      }
    },
    [reference],
    { failureText: 'Не удалось загрузить звонок', ...(polling ? { refreshMs: LIVE_REFRESH_MS } : {}) }
  );
  const [selected, setSelected] = useState<string | null>(null);
  // A finished call does not change: only one going on tells the top bar how fresh it is.
  const freshness = polling ? (
    <RefreshReport at={loadedAt} everyMs={LIVE_REFRESH_MS} busy={busy} reload={reload} />
  ) : null;

  const back = (
    <button type="button" className="call-back" aria-label="Назад к комнатам" onClick={onBack}>
      <ArrowLeft size={16} aria-hidden="true" />
    </button>
  );

  if (failure && !data) {
    return (
      <>
        {freshness}
        <div className="call-head">{back}</div>
        {ended ? <Empty>{failure.message}</Empty> : <Notice failure={failure} onRetry={reload} />}
      </>
    );
  }
  if (!data) {
    return (
      <>
        {freshness}
        <p className="ui-empty" aria-busy="true">
          Загружаем…
        </p>
      </>
    );
  }

  const call = data.call;
  const events = data.events ?? [];
  const people = peopleOf(call);
  const person = people.find((one) => one.key === selected) ?? people[0] ?? null;
  const allMinutes = call.stays.flatMap((stay) => stay.minutes ?? []);
  const quality = qualityOfMinutes(allMinutes);
  const shares = quality ? qualityShares(quality) : null;
  const judgedMinutes = quality ? quality.good + quality.unstable + quality.bad : 0;
  const peak = peakOf(call);
  const accounts = people.filter((one) => one.account).length;
  const guests = people.length - accounts;
  const rtt = seriesOf(allMinutes.map((minute) => minute.rttMs));
  const loss = seriesOf(allMinutes.map((minute) => minute.uplinkLossPct));
  const rttByPerson = people
    .map((one) => ({ name: personName(one), avg: seriesOf(minutesOfPerson(one).map((minute) => minute.rttMs)).avg }))
    .filter((one): one is { name: string; avg: number } => one.avg !== null)
    .sort((a, b) => b.avg - a.avg);
  const overloaded = people.filter((one) => minutesOfPerson(one).some((minute) => minute.cpuPressure === 'critical'));
  const shared = sharedAddresses(people);
  const owner = data.owner ?? null;
  const feedback = data.feedback;
  const named = Boolean(call.roomName) && call.roomName !== call.roomId;

  return (
    <div className="call-page">
      {freshness}
      {failure && !ended ? (
        <p className="admin-error" role="alert">
          {failure.message}
        </p>
      ) : null}
      <section className="call-head" aria-label="Звонок">
        {back}
        <RoomAvatar roomId={call.roomId} name={named ? call.roomName : null} src={call.avatarUrl ?? null} size={48} />
        <div className="call-head-text">
          <div className="call-head-title">
            <h2 className={named ? undefined : 'ui-mono'}>{named ? call.roomName : call.roomId}</h2>
            {call.roomName === null ? (
              <Pill tone="danger" compact>
                удалена
              </Pill>
            ) : call.isStatic ? (
              <Pill tone="accent" compact>
                постоянная
              </Pill>
            ) : (
              <Pill compact>временная</Pill>
            )}
            {ended ? (
              <Pill compact>звонок закончился</Pill>
            ) : live ? (
              <Pill tone="success" dot compact>
                идёт сейчас
              </Pill>
            ) : null}
            {shares && shares.bad >= TROUBLE_PCT ? (
              <Pill tone="danger" dot compact>
                связь хуже нормы
              </Pill>
            ) : null}
          </div>
          <span className="call-head-line">
            {`${formatDayHeading(call.startedAt, loadedAt ?? call.endedAt)}, `}
            <span className="ui-mono">
              {formatClock(call.startedAt)}–{live ? 'сейчас' : formatClock(call.endedAt)}
            </span>
            {` · ${formatDuration(call.endedAt - call.startedAt)} · ${formatPeople(people.length)}`}
            {owner ? (
              <>
                {' · владелец '}
                <span className="ui-mono">@{owner.login}</span>
              </>
            ) : null}
            {' · код '}
            <span className="ui-mono">{call.roomId}</span>
          </span>
        </div>
        <div className="call-head-actions">
          <Button onClick={() => onOpenRoomHistory({ id: call.roomId, name: call.roomName })}>
            <History size={15} aria-hidden="true" />
            Все звонки комнаты
          </Button>
          {feedback ? (
            <a className="ui-button ui-button--ghost" href="#feedback">
              {`Отзывы · ${formatCount(feedback.length)}`}
            </a>
          ) : null}
        </div>
      </section>

      <Stats label="Цифры звонка" min={150}>
        <Stat
          label="Длительность"
          value={formatDuration(call.endedAt - call.startedAt)}
          note={`пик — ${formatPeople(peak.people)} в ${formatClock(peak.at)}`}
        />
        <Stat
          label="Участников"
          value={formatCount(people.length)}
          note={`${formatCount(accounts)} ${plural(accounts, ['аккаунт', 'аккаунта', 'аккаунтов'])} · ${formatCount(guests)} ${plural(guests, ['гость', 'гостя', 'гостей'])}`}
        />
        <Stat
          label="Плохих минут"
          dot={shares && shares.bad >= TROUBLE_PCT ? 'danger' : undefined}
          tone={shares && shares.bad >= TROUBLE_PCT ? 'danger' : undefined}
          value={shares ? `${formatCount(shares.bad)} %` : '—'}
          note={
            quality ? `${formatCount(quality.bad)} из ${formatCount(judgedMinutes)} минут участников` : 'нет данных'
          }
        />
        <Stat
          label="Средний RTT"
          value={rtt.avg === null ? '—' : formatMs(Math.round(rtt.avg))}
          note={
            rttByPerson[0]
              ? `хуже всех — ${rttByPerson[0].name}, ${formatMs(Math.round(rttByPerson[0].avg))}`
              : undefined
          }
        />
        <Stat
          label="Потери на сервере"
          value={loss.avg === null ? '—' : formatPercent(loss.avg)}
          note="аудио, от участников к LiveKit"
        />
        <Stat
          label="Процессор перегружен"
          dot={overloaded.length ? 'warning' : undefined}
          value={formatPeople(overloaded.length)}
          note={overloaded.length ? overloaded.map(personName).join(', ') : undefined}
        />
      </Stats>

      <section className="call-card call-card--flush" aria-labelledby="call-people-title">
        <header className="call-card-head">
          <h3 id="call-people-title">Кто и когда был в звонке</h3>
          <NetworkLegend />
        </header>
        <div className="ui-table-scroll">
          <CallPeople
            call={call}
            onOpenAccount={onOpenAccount}
            selected={person?.key ?? null}
            onSelect={setSelected}
            sharedKeys={new Set(shared.keys())}
            axis={<Axis from={call.startedAt} to={call.endedAt} />}
            columns={PEOPLE_COLUMNS}
          />
        </div>
        {[...shared.values()].map((sharing) => (
          <p key={sharing[0]?.seat.ipKey ?? ''} className="call-shared">
            {`Одинаковый ключ адреса — один и тот же IP: ${sharing.map(personName).join(', ')}. Сам адрес не хранится.`}
          </p>
        ))}
      </section>

      {person ? (
        <div className="call-pair">
          <section className="call-card call-pair-wide" aria-labelledby="call-minutes-title">
            <header className="call-card-head call-card-head--inset">
              <h3 id="call-minutes-title">Связь по минутам: {personName(person)}</h3>
              <span className="call-note">выберите участника в таблице выше</span>
            </header>
            {minutesOfPerson(person).length === 0 ? (
              <Empty>Клиент не присылал статистику</Empty>
            ) : (
              <>
                <MinuteChart
                  label="Задержка (RTT)"
                  from={call.startedAt}
                  to={call.endedAt}
                  limit={RTT_LIMIT_MS}
                  format={(value) => (value === null ? '—' : formatMs(Math.round(value)))}
                  points={minutesOfPerson(person).map((minute) => ({ at: minute.at, value: minute.rttMs }))}
                />
                <MinuteChart
                  label="Задержка голоса: пинг, буфер и кодек"
                  from={call.startedAt}
                  to={call.endedAt}
                  limit={DELAY_LIMIT_MS}
                  format={(value) => (value === null ? '—' : formatMs(Math.round(value)))}
                  points={minutesOfPerson(person).map((minute) => ({ at: minute.at, value: delayOf(minute) }))}
                />
                <MinuteChart
                  label="Потери от участника к серверу"
                  from={call.startedAt}
                  to={call.endedAt}
                  limit={LOSS_LIMIT_PCT}
                  format={(value) => (value === null ? '—' : formatPercent(value))}
                  points={minutesOfPerson(person).map((minute) => ({ at: minute.at, value: minute.uplinkLossPct }))}
                />
                <MinuteChart
                  label="Как его слышали: додуманная речь, худшие 15 с минуты"
                  from={call.startedAt}
                  to={call.endedAt}
                  limit={CONCEALED_LIMIT_PCT}
                  format={(value) => (value === null ? '—' : formatPercent(value))}
                  points={minutesOfPerson(person).map((minute) => ({
                    at: minute.at,
                    value: worstOf(minute.heardBy)
                  }))}
                />
                <MinuteChart
                  label="Как он слышал: додуманная речь, худшие 15 с минуты"
                  from={call.startedAt}
                  to={call.endedAt}
                  limit={CONCEALED_LIMIT_PCT}
                  format={(value) => (value === null ? '—' : formatPercent(value))}
                  points={minutesOfPerson(person).map((minute) => ({
                    at: minute.at,
                    value: worstOf(minute.heard)
                  }))}
                />
                <div className="call-levels">
                  <span className="minute-chart-label">Уровень связи</span>
                  <span className="call-bar call-levels-bar" aria-hidden="true">
                    {person.spans.map((span) => {
                      const length = Math.max(1, call.endedAt - call.startedAt);
                      return (
                        <NetworkSpan
                          key={span.from}
                          from={span.from}
                          to={span.to}
                          voice={span}
                          style={{
                            left: `${((span.from - call.startedAt) / length) * 100}%`,
                            width: `${Math.max(1, ((span.to - span.from) / length) * 100)}%`
                          }}
                        />
                      );
                    })}
                  </span>
                  <Axis from={call.startedAt} to={call.endedAt} />
                </div>
              </>
            )}
          </section>
          <PersonPanel person={person} events={events} onOpenAccount={onOpenAccount} />
        </div>
      ) : null}

      <div className="call-pair">
        <Events events={events} stays={call.stays} endedAt={live ? null : call.endedAt} />
        {feedback ? <Feedback entries={feedback} /> : null}
      </div>
    </div>
  );
}
