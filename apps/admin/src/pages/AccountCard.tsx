// One account in full: its numbers, the last 90 days, its rooms and
// devices, what was reported about it, and what the signed-in staff member may
// do — a moderator blocks for a time and signs out everywhere; an admin also
// blocks for good, deletes and gives the official mark — with the log of what
// staff already did.

import { ArrowLeft, BadgeCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { AccountDetail, BlockDuration } from '@voice-room/shared/contracts/admin';
import { blockTerm, describeAction } from '../accounts.ts';
import {
  blockAccount,
  cancelAccountDeletion,
  deleteAccount,
  fetchAccount,
  setAccountBadge,
  signOutAccount,
  unblockAccount
} from '../api/admin.ts';
import { forgetBadges } from '../badges.ts';
import { TimeChart } from '../charts/TimeChart.tsx';
import { formatAgo, formatCount, formatDateTime, formatDay, formatMinutes, formatNumericDate } from '../format.ts';
import { usePageTitle } from '../frame.tsx';
import { loadFailure, type LoadFailure } from '../load-state.ts';
import { Notice } from '../Notice.tsx';
import { useCan } from '../staff.tsx';
import { AccountBadge, Avatar, Button, Dialog, Switch } from '../ui/index.tsx';
import { AccountBlockDialog } from './AccountBlockDialog.tsx';
import { AccountDeleteDialog } from './AccountDeleteDialog.tsx';
import './AccountCard.css';

export function AccountCard({ userId, onBack }: { userId: string; onBack: () => void }) {
  const canModerate = useCan('accounts.moderate');
  const canManage = useCan('accounts.manage');
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<'block' | 'delete' | 'sign-out' | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    fetchAccount(userId).then(
      (loaded) => {
        if (!alive) return;
        setDetail(loaded);
        setFailure(null);
        setNow(Date.now());
      },
      (cause: unknown) => {
        if (alive) setFailure(loadFailure(cause, 'Не удалось загрузить аккаунт'));
      }
    );
    return () => {
      alive = false;
    };
  }, [userId, attempt]);

  const closeDialog = useCallback(() => setDialog(null), []);
  // The top bar names the account once it is known.
  usePageTitle(detail ? detail.account.displayName || detail.account.login : null);

  /** Runs one action; the answer is the card as it is now. */
  async function run(action: () => Promise<AccountDetail>, fallback: string): Promise<string | null> {
    setBusy(true);
    setActionError('');
    try {
      setDetail(await action());
      setNow(Date.now());
      setDialog(null);
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

  const confirmBlock = (input: { duration: BlockDuration; reason: string }) =>
    run(() => blockAccount(userId, input), 'Не удалось заблокировать');
  const confirmDelete = (input: { login: string; reason: string }) =>
    run(() => deleteAccount(userId, input), 'Не удалось удалить аккаунт');

  function toggleOfficial(checked: boolean): void {
    void runInline(async () => {
      const changed = await setAccountBadge(userId, checked ? 'official' : null);
      // Names everywhere in this tab pick the mark up at once.
      forgetBadges();
      return changed;
    }, 'Не удалось изменить отметку');
  }

  const back = (
    <div className="card-top">
      <Button variant="ghost" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true" />
        Все аккаунты
      </Button>
    </div>
  );

  if (failure && !detail) {
    return (
      <>
        {back}
        <Notice
          failure={failure}
          onRetry={() => {
            setFailure(null);
            setAttempt((value) => value + 1);
          }}
        />
      </>
    );
  }
  if (!detail) {
    return (
      <>
        {back}
        <p className="card-quiet" aria-busy="true">
          Загружаем…
        </p>
      </>
    );
  }

  const account = detail.account;
  const name = account.displayName || account.login;
  const days = detail.days;
  const labels = days.map((day) => formatDay(day.day));
  const activeInSpan = days.filter((day) => day.active).length;
  const clients = [
    account.clients.desktopApp ? 'приложение' : '',
    account.clients.browser ? 'браузер' : '',
    account.clients.mobile ? 'телефон' : ''
  ].filter(Boolean);
  // A block with an end is lifted by a moderator; one without an end needs an admin.
  const canUnblock = detail.block?.until === null ? canManage : canModerate;

  return (
    <>
      {back}
      <header className="card-head">
        <span className="card-avatar">
          <Avatar
            name={name}
            src={account.avatarUrl}
            colorKey={account.avatarColorKey}
            background={account.avatarAccent}
            size={64}
          />
          {account.online ? <span className="card-dot" aria-hidden="true" /> : null}
        </span>
        <div className="card-identity">
          <h2>
            {name}
            <AccountBadge key={account.badge ?? 'none'} userId={account.id} />
          </h2>
          <span className="card-login">@{account.login}</span>
          <span className="card-chips">
            {account.online ? (
              <span className="card-chip" data-tone="success">
                в сети
              </span>
            ) : null}
            {account.admin ? (
              <span className="card-chip" data-tone="accent">
                сотрудник
              </span>
            ) : null}
            {account.badge === 'official' ? (
              <span className="card-chip" data-tone="accent">
                официальный аккаунт
              </span>
            ) : null}
            {account.status === 'blocked' ? (
              <span className="card-chip" data-tone="danger">
                заблокирован
              </span>
            ) : null}
            {account.status === 'deleting' ? (
              <span className="card-chip" data-tone="danger">
                удаляется
              </span>
            ) : null}
          </span>
        </div>
      </header>

      {detail.deletion ? (
        <div className="card-banner" role="status">
          <span>
            Удалится {formatDateTime(detail.deletion.scheduledFor)} —{' '}
            {detail.deletion.byAdmin ? 'по решению администратора' : 'по просьбе владельца'}.
          </span>
          {detail.deletion.byAdmin && canManage ? (
            <Button
              disabled={busy}
              onClick={() => void runInline(() => cancelAccountDeletion(userId), 'Не удалось отменить удаление')}
            >
              Отменить удаление
            </Button>
          ) : null}
        </div>
      ) : null}
      {detail.block && !detail.deletion?.byAdmin ? (
        <div className="card-banner" role="status">
          <span>
            Заблокирован {blockTerm(detail.block.until)}. Причина: {detail.block.reason}
          </span>
          {canUnblock ? (
            <Button
              disabled={busy}
              onClick={() => void runInline(() => unblockAccount(userId), 'Не удалось разблокировать')}
            >
              Разблокировать
            </Button>
          ) : null}
        </div>
      ) : null}
      {actionError ? (
        <p className="card-error" role="alert">
          {actionError}
        </p>
      ) : null}

      <section className="card-tiles" aria-label="Цифры">
        <div className="card-tile">
          <span className="card-tile-label">Регистрация</span>
          <span className="card-tile-value">{formatNumericDate(account.createdAt)}</span>
        </div>
        <div className="card-tile">
          <span className="card-tile-label">Последний визит</span>
          <span className="card-tile-value">{account.online ? 'сейчас' : formatAgo(account.lastSeenAt, now)}</span>
        </div>
        <div className="card-tile">
          <span className="card-tile-label">Активных дней</span>
          <span className="card-tile-value">{formatCount(account.activeDays)}</span>
          <span className="card-tile-hint">{clients.length ? clients.join(', ') : 'нет данных о клиентах'}</span>
        </div>
        <div className="card-tile">
          <span className="card-tile-label">В войсе</span>
          <span className="card-tile-value">{formatMinutes(account.voiceMinutes)}</span>
        </div>
        <div className="card-tile">
          <span className="card-tile-label">Сообщений</span>
          <span className="card-tile-value">{formatCount(account.messages)}</span>
        </div>
        <div className="card-tile">
          <span className="card-tile-label">Комнаты</span>
          <span className="card-tile-value">{formatCount(account.ownedRooms)}</span>
          <span className="card-tile-hint">своих · участник в {formatCount(detail.memberOf)}</span>
        </div>
        <div className="card-tile">
          <span className="card-tile-label">Жалобы на аккаунт</span>
          <span className="card-tile-value" data-alert={detail.reports.againstOpen > 0}>
            {formatCount(detail.reports.against)}
          </span>
          <span className="card-tile-hint">
            {detail.reports.againstOpen ? `открытых: ${detail.reports.againstOpen}` : 'открытых нет'} · от аккаунта:{' '}
            {formatCount(detail.reports.filed)}
          </span>
        </div>
      </section>

      <div className="card-charts">
        <TimeChart
          title="Сообщения за 90 дней"
          kind="bar"
          labels={labels}
          series={[{ name: 'Сообщения', values: days.map((day) => day.messages), color: 'var(--vr-accent)' }]}
          note={`Активных дней: ${activeInSpan} из ${days.length}.`}
        />
        <TimeChart
          title="Войс за 90 дней"
          kind="bar"
          labels={labels}
          format={formatMinutes}
          series={[{ name: 'В войсе', values: days.map((day) => day.voiceMinutes), color: 'var(--vr-success)' }]}
        />
      </div>

      <div className="card-columns">
        <section className="card-box" aria-label="Комнаты">
          <h3>Свои постоянные комнаты</h3>
          {detail.ownedRooms.length === 0 ? (
            <p className="card-quiet">Нет.</p>
          ) : (
            <ul className="card-list">
              {detail.ownedRooms.map((room) => (
                <li key={room.id}>
                  {room.name || 'Без названия'}
                  <span>{formatCount(room.members)} участн.</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card-box" aria-label="Устройства">
          <h3>Устройства со входом</h3>
          {detail.devices.length === 0 ? (
            <p className="card-quiet">Ни одного открытого сеанса.</p>
          ) : (
            <ul className="card-list">
              {detail.devices.map((device, index) => (
                <li key={index}>
                  {[device.client || 'Неизвестный клиент', device.os].filter(Boolean).join(' · ')}
                  <span>{formatAgo(device.lastSeenAt, now)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card-box" aria-label="Действия">
        <h3>Действия</h3>
        {canManage ? (
          <div className="card-official">
            <BadgeCheck size={16} aria-hidden="true" />
            <span>
              <strong>Официальный аккаунт VoiceRoom</strong>
              <small>Галочка у имени везде; только ему можно называться VoiceRoom.</small>
            </span>
            <Switch
              checked={account.badge === 'official'}
              disabled={busy}
              label="Официальный аккаунт"
              onChange={toggleOfficial}
            />
          </div>
        ) : null}
        {account.admin ? (
          <p className="card-quiet">Это аккаунт сотрудника: заблокировать, разлогинить или удалить его нельзя.</p>
        ) : (
          <div className="card-actions">
            {canModerate && account.status === 'active' ? (
              <Button disabled={busy} onClick={() => setDialog('block')}>
                Заблокировать…
              </Button>
            ) : null}
            {canModerate ? (
              <Button disabled={busy || detail.devices.length === 0} onClick={() => setDialog('sign-out')}>
                Разлогинить везде
              </Button>
            ) : null}
            {canManage && !detail.deletion ? (
              <Button className="card-danger" disabled={busy} onClick={() => setDialog('delete')}>
                Удалить аккаунт…
              </Button>
            ) : null}
          </div>
        )}
      </section>

      <section className="card-box" aria-label="История действий">
        <h3>История действий администраторов</h3>
        {detail.actions.length === 0 ? (
          <p className="card-quiet">Пока ничего.</p>
        ) : (
          <ol className="card-log">
            {detail.actions.map((entry) => (
              <li key={entry.id}>
                <span className="card-log-what">{describeAction(entry)}</span>
                {entry.reason ? <span className="card-log-reason">«{entry.reason}»</span> : null}
                <span className="card-log-meta">
                  {formatDateTime(entry.at)} · {entry.adminName}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <AccountBlockDialog open={dialog === 'block'} name={name} onClose={closeDialog} onConfirm={confirmBlock} />
      <AccountDeleteDialog
        open={dialog === 'delete'}
        login={account.login}
        onClose={closeDialog}
        onConfirm={confirmDelete}
      />
      <Dialog open={dialog === 'sign-out'} title="Разлогинить везде" onClose={closeDialog}>
        <div className="card-confirm">
          <p>
            Все сеансы <strong>{name}</strong> завершатся, звонок прервётся. Войти снова можно будет с паролем — это не
            блокировка.
          </p>
          <div className="card-confirm-actions">
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
          </div>
        </div>
      </Dialog>
    </>
  );
}
