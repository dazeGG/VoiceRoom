// One account beside the list: who it is and whether it is in a call, how its
// voice and its computer did over 30 days, its latest calls, and what staff can
// do from here. The account's full card stays one click away. What the computer
// says is the client's own report, and any conclusion from it is only a hint.

import { ArrowUpRight, PhoneCall } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { AccountDetail, BlockDuration, LiveRoom, RoomCall } from '@voice-room/shared/contracts/admin';
import { blockAccount, fetchAccount, fetchRoomCalls, signOutAccount, unblockAccount } from '../api/admin.ts';
import {
  formatAgo,
  formatClock,
  formatCount,
  formatDayHeading,
  formatDuration,
  formatMinutes,
  formatMs,
  formatNumericDate,
  formatPercent,
  plural
} from '../format.ts';
import { useAdminResource } from '../load-state.ts';
import { Notice } from '../Notice.tsx';
import { useCan } from '../staff.tsx';
import type { CallRef } from '../tabs.ts';
import { Avatar, Button, Dialog, Empty, Pill, type Tone } from '../ui/index.tsx';
import { TextLink } from '../ui/Section.tsx';
import { AccountBlockDialog } from './AccountBlockDialog.tsx';
import { QualityBar, qualityOfMinutes, qualityShares } from './rooms/QualityBar.tsx';
import './AccountPanel.css';

const REFRESH_MS = 30_000;
const RECENT_CALLS = 3;
/** The system this much busier than VoiceRoom itself means something else was taking the computer. */
const SYSTEM_OVER_APP_PCT = 40;
const BUSY_SYSTEM_PCT = 90;

type NetTone = 'plain' | 'warning' | 'danger';
const toneOf = (value: number | null, warning: number, danger: number): NetTone =>
  value === null || value < warning ? 'plain' : value < danger ? 'warning' : 'danger';

function statusOf({ account }: AccountDetail): { label: string; tone: Tone } {
  if (account.status === 'deleting') return { label: 'удаляется', tone: 'danger' };
  if (account.status === 'blocked') return { label: 'заблокирован', tone: 'danger' };
  return account.online ? { label: 'в сети', tone: 'success' } : { label: 'не в сети', tone: 'neutral' };
}

type Cpu = NonNullable<AccountDetail['cpu30d']>;

/** One careful phrase about the computer: nothing it could not know from these numbers. */
export function cpuConclusion(cpu: Cpu, badMinutes: number): string {
  const { appAvgPct: app, systemAvgPct: system, calls, criticalCalls, relievedCalls } = cpu;
  if (criticalCalls === 0) return 'Перегрузок процессора в звонках не было.';
  const overload = `Перегрузка в ${formatCount(criticalCalls)} из ${formatCount(calls)} звонков`;
  const relief = relievedCalls ? ', шумодав переключался на облегчённый' : '';
  const elsewhere = app !== null && system !== null && system - app >= SYSTEM_OVER_APP_PCT;
  if (elsewhere && badMinutes > 0 && criticalCalls * 2 >= calls) {
    return `${overload}${relief}. Система занята намного больше самого VoiceRoom: скорее всего, параллельно запущена игра.`;
  }
  return `${overload}${relief}.`;
}

function LatestCalls({
  accountId,
  calls,
  now,
  onOpenCall
}: {
  accountId: string;
  calls: readonly RoomCall[];
  now: number;
  onOpenCall: (call: CallRef) => void;
}) {
  return calls.map((call) => {
    // The level shown is the account's own in that call, not the room's.
    const own = call.stays.filter((stay) => stay.account?.id === accountId).flatMap((stay) => stay.minutes ?? []);
    const quality = qualityOfMinutes(own);
    const shares = quality && qualityShares(quality);
    const level = !shares ? 'unknown' : shares.bad ? 'bad' : shares.unstable ? 'unstable' : 'good';
    const levelText = !shares
      ? 'нет данных о связи'
      : shares.bad
        ? `плохая связь ${shares.bad}%`
        : shares.unstable
          ? `нестабильно ${shares.unstable}%`
          : 'связь в порядке';
    return (
      <button
        key={call.id}
        type="button"
        className="panel-call"
        onClick={() => onOpenCall({ kind: 'finished', callId: call.id })}
      >
        <span className="net-dot panel-call-dot" data-net={level} title={levelText} aria-hidden="true" />
        <span className="panel-call-text">
          <span className="panel-call-room">{call.roomName || call.roomId}</span>
          <span className="panel-note">
            {`${formatDayHeading(call.startedAt, now)}, ${formatClock(call.startedAt)} · ${levelText}`}
          </span>
        </span>
        <span className="panel-note ui-num">{formatDuration(call.endedAt - call.startedAt)}</span>
      </button>
    );
  });
}

export function AccountPanel({
  userId,
  liveRooms,
  onOpenCard,
  onOpenCall,
  onShowCalls,
  onChanged
}: {
  userId: string;
  liveRooms: readonly LiveRoom[];
  onOpenCard: (accountId: string) => void;
  onOpenCall: (call: CallRef) => void;
  onShowCalls: () => void;
  /** An action changed the account: the list shows it. */
  onChanged: () => void;
}) {
  const canModerate = useCan('accounts.moderate');
  const canManage = useCan('accounts.manage');
  const canRooms = useCan('rooms.view');
  const {
    data: detail,
    failure,
    heardAt,
    reload,
    update
  } = useAdminResource(() => fetchAccount(userId), [userId], {
    failureText: 'Не удалось загрузить аккаунт',
    refreshMs: REFRESH_MS
  });
  const calls = useAdminResource(
    () => (canRooms ? fetchRoomCalls({ accountId: userId }) : Promise.resolve(null)),
    [userId, canRooms],
    { failureText: 'Не удалось загрузить звонки', refreshMs: REFRESH_MS }
  );
  const [dialog, setDialog] = useState<'block' | 'sign-out' | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const closeDialog = useCallback(() => setDialog(null), []);

  async function run(action: () => Promise<AccountDetail>, fallback: string): Promise<string | null> {
    setBusy(true);
    setActionError('');
    try {
      const changed = await action();
      update(() => changed);
      setDialog(null);
      onChanged();
      return null;
    } catch (cause) {
      return cause instanceof Error && cause.message ? cause.message : fallback;
    } finally {
      setBusy(false);
    }
  }

  async function runInline(action: () => Promise<AccountDetail>, fallback: string): Promise<void> {
    setActionError((await run(action, fallback)) ?? '');
  }

  if (failure && !detail) {
    return (
      <aside className="acc-panel" aria-label="Аккаунт">
        <Notice failure={failure} onRetry={reload} />
      </aside>
    );
  }
  if (!detail) {
    return (
      <aside className="acc-panel" aria-label="Аккаунт">
        <p className="panel-card ui-empty" aria-busy="true">
          Загружаем…
        </p>
      </aside>
    );
  }

  const now = heardAt ?? 0;
  const { account } = detail;
  const name = account.displayName || account.login;
  const status = statusOf(detail);
  const inCall = liveRooms.find((room) => room.peers.some((peer) => peer.account?.id === userId));
  const voice = detail.voice30d ?? null;
  const cpu = detail.cpu30d ?? null;
  const shares = voice ? qualityShares(voice.quality) : null;
  // An API a release behind ignores the account asked for: only the calls it was in are its calls.
  const latest =
    calls.data?.calls.filter((call) => call.stays.some((stay) => stay.account?.id === userId)).slice(0, RECENT_CALLS) ??
    [];
  const canUnblock = detail.block ? (detail.block.until === null ? canManage : canModerate) : false;
  const netCells = voice
    ? [
        {
          label: 'RTT',
          value: voice.rttAvgMs === null ? '—' : formatMs(voice.rttAvgMs),
          tone: toneOf(voice.rttAvgMs, 100, 150)
        },
        {
          label: 'Потери от него',
          value: voice.uplinkLossPct === null ? '—' : formatPercent(voice.uplinkLossPct),
          tone: toneOf(voice.uplinkLossPct, 2, 5)
        },
        {
          label: 'Буфер джиттера',
          value: voice.jitterBufferAvgMs === null ? '—' : formatMs(voice.jitterBufferAvgMs),
          tone: toneOf(voice.jitterBufferAvgMs, 60, 100)
        },
        {
          label: 'Транспорт',
          value:
            voice.transport.udp + voice.transport.tcp + voice.transport.relay === 0
              ? '—'
              : voice.transport.relay >= voice.transport.udp && voice.transport.relay >= voice.transport.tcp
                ? `TURN ${voice.transport.relay}%`
                : voice.transport.tcp > voice.transport.udp
                  ? `TCP ${voice.transport.tcp}%`
                  : `UDP ${voice.transport.udp}%`,
          tone: 'plain' as const
        }
      ]
    : [];

  return (
    <aside className="acc-panel" aria-label={`Аккаунт: ${name}`}>
      <section className="panel-card">
        <div className="panel-who">
          <Avatar
            name={name}
            src={account.avatarUrl}
            colorKey={account.avatarColorKey}
            background={account.avatarAccent}
            size={48}
          />
          <span className="panel-who-text">
            <h2 className="panel-name">{name}</h2>
            <span className="panel-login ui-mono">{`@${account.login} · id ${account.id}`}</span>
          </span>
          <Pill tone={status.tone} dot compact>
            {status.label}
          </Pill>
        </div>
        {inCall ? (
          <button
            type="button"
            className="panel-in-call"
            onClick={() => onOpenCall({ kind: 'live', roomId: inCall.roomId })}
          >
            <PhoneCall size={16} aria-hidden="true" />
            <span className="panel-in-call-text">
              Сейчас в звонке: <b>{inCall.name}</b>
            </span>
            <ArrowUpRight size={16} aria-hidden="true" />
          </button>
        ) : null}
        <dl className="panel-facts">
          <div>
            <dt>Регистрация</dt>
            <dd className="ui-num">{formatNumericDate(account.createdAt)}</dd>
          </div>
          <div>
            <dt>Последний визит</dt>
            <dd>{account.online ? 'в сети' : formatAgo(account.lastSeenAt, now)}</dd>
          </div>
          <div>
            <dt>Активных дней за 90</dt>
            <dd className="ui-num">{formatCount(account.activeDays)}</dd>
          </div>
          <div>
            <dt>В войсе за 90 дней</dt>
            <dd className="ui-num">{formatMinutes(account.voiceMinutes)}</dd>
          </div>
          <div>
            <dt>Сообщений</dt>
            <dd className="ui-num">{formatCount(account.messages)}</dd>
          </div>
          <div>
            <dt>Комнаты</dt>
            <dd>
              {`${formatCount(detail.ownedRooms.length)} ${plural(detail.ownedRooms.length, ['своя', 'своих', 'своих'])} · участник ${formatCount(detail.memberOf)}`}
            </dd>
          </div>
        </dl>
      </section>

      {detail.voice30d === undefined ? null : (
        <section className="panel-card" aria-labelledby="panel-voice-title">
          <header className="panel-head">
            <h3 id="panel-voice-title">Связь за 30 дней</h3>
            {voice ? <span className="panel-note">{formatMinutes(voice.minutes)}</span> : null}
          </header>
          {voice && shares ? (
            <>
              <div className="panel-quality">
                <QualityBar quality={voice.quality} height={10} />
                <span className="net-legend">
                  <span className="net-legend-item">
                    <span className="net-dot" data-net="good" aria-hidden="true" />
                    {`в порядке ${shares.good}%`}
                  </span>
                  <span className="net-legend-item">
                    <span className="net-dot" data-net="unstable" aria-hidden="true" />
                    {`нестабильно ${shares.unstable}%`}
                  </span>
                  <span className="net-legend-item">
                    <span className="net-dot" data-net="bad" aria-hidden="true" />
                    {`плохо ${shares.bad}%`}
                  </span>
                </span>
              </div>
              <div className="panel-grid">
                {netCells.map((cell) => (
                  <div key={cell.label} className="panel-cell">
                    <span className="panel-note">{cell.label}</span>
                    <span className="panel-cell-value" data-tone={cell.tone}>
                      {cell.value}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="panel-quiet">За 30 дней не был в войсе.</p>
          )}
        </section>
      )}

      {cpu ? (
        <section className="panel-card" aria-labelledby="panel-cpu-title">
          <header className="panel-head">
            <h3 id="panel-cpu-title">Процессор в звонках</h3>
            <span className="panel-note">по отчётам клиента</span>
          </header>
          <div className="panel-cpu">
            <span className="panel-cpu-name">VoiceRoom</span>
            <span className="panel-meter">
              <span data-tone="accent" style={{ width: `${Math.min(100, cpu.appAvgPct ?? 0)}%` }} />
            </span>
            <span className="ui-num panel-cpu-value">{cpu.appAvgPct === null ? '—' : `${cpu.appAvgPct}%`}</span>
            <span className="panel-cpu-name">Вся система</span>
            <span className="panel-meter">
              <span
                data-tone={(cpu.systemAvgPct ?? 0) >= BUSY_SYSTEM_PCT ? 'danger' : 'accent'}
                style={{ width: `${Math.min(100, cpu.systemAvgPct ?? 0)}%` }}
              />
            </span>
            <span className="ui-num panel-cpu-value">{cpu.systemAvgPct === null ? '—' : `${cpu.systemAvgPct}%`}</span>
          </div>
          <p className="panel-quiet">{cpuConclusion(cpu, voice?.quality.bad ?? 0)}</p>
        </section>
      ) : null}

      {canRooms ? (
        <section className="panel-card panel-card--flush" aria-labelledby="panel-calls-title">
          <header className="panel-head panel-head--inset">
            <h3 id="panel-calls-title">Последние звонки</h3>
            <TextLink onClick={onShowCalls}>Все</TextLink>
          </header>
          {calls.failure && !calls.data ? (
            <p className="panel-quiet panel-inset">{calls.failure.message}</p>
          ) : latest.length ? (
            <LatestCalls accountId={userId} calls={latest} now={now} onOpenCall={onOpenCall} />
          ) : calls.data ? (
            <Empty>Звонков не было</Empty>
          ) : (
            <p className="panel-quiet panel-inset" aria-busy="true">
              Загружаем…
            </p>
          )}
        </section>
      ) : null}

      {actionError ? (
        <p className="admin-error" role="alert">
          {actionError}
        </p>
      ) : null}
      <div className="panel-actions">
        <Button variant="primary" className="panel-open" onClick={() => onOpenCard(userId)}>
          Открыть карточку аккаунта
        </Button>
        {account.admin || !canModerate ? null : (
          <>
            <Button disabled={busy || detail.devices.length === 0} onClick={() => setDialog('sign-out')}>
              Разлогинить везде
            </Button>
            {account.status === 'active' ? (
              <Button variant="danger-outline" disabled={busy} onClick={() => setDialog('block')}>
                Заблокировать
              </Button>
            ) : canUnblock && !detail.deletion?.byAdmin ? (
              <Button
                variant="danger-outline"
                disabled={busy}
                onClick={() => void runInline(() => unblockAccount(userId), 'Не удалось разблокировать')}
              >
                Разблокировать
              </Button>
            ) : null}
          </>
        )}
      </div>

      <AccountBlockDialog
        open={dialog === 'block'}
        name={name}
        onClose={closeDialog}
        onConfirm={(input: { duration: BlockDuration; reason: string }) =>
          run(() => blockAccount(userId, input), 'Не удалось заблокировать')
        }
      />
      <Dialog
        open={dialog === 'sign-out'}
        title="Разлогинить везде"
        onClose={closeDialog}
        footer={
          <>
            <Button variant="ghost" onClick={closeDialog}>
              Отмена
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => void runInline(() => signOutAccount(userId), 'Не удалось завершить сеансы')}
            >
              Разлогинить
            </Button>
          </>
        }
      >
        <p className="panel-confirm">
          Все сеансы <strong>{name}</strong> завершатся, звонок прервётся. Войти снова можно будет с паролем — это не
          блокировка.
        </p>
      </Dialog>
    </aside>
  );
}
