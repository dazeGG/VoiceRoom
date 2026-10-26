// One account in full: its numbers, the last 90 days, its rooms and
// devices, what was reported about it, and what the signed-in staff member may
// do — a moderator blocks for a time and signs out everywhere; an admin also
// blocks for good, deletes and gives the official mark — with the log of what
// staff already did. The account and its story on the left, what can be done
// with it on the right.

import { AppWindow, ArrowLeft, BadgeCheck, Ban, Globe, Lock, LogOut, Smartphone, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { AccountDetail, AdminActionEntry, BlockDuration } from '@voice-room/shared/contracts/admin';
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
import {
  formatAgo,
  formatCount,
  formatDateTime,
  formatDay,
  formatHours,
  formatMinutes,
  formatNumericDate,
  plural
} from '../format.ts';
import { usePageTitle } from '../frame.tsx';
import { useAdminResource } from '../load-state.ts';
import { Notice } from '../Notice.tsx';
import { useCan } from '../staff.tsx';
import {
  AccountBadge,
  Avatar,
  Button,
  Dialog,
  Empty,
  Panel,
  Pill,
  RoomAvatar,
  Skeleton,
  Stat,
  Stats,
  Switch,
  type Tone
} from '../ui/index.tsx';
import { AccountBlockDialog } from './AccountBlockDialog.tsx';
import { AccountDeleteDialog } from './AccountDeleteDialog.tsx';
import './AccountCard.css';

/** A log entry's dot: a block is red, a deletion amber, a block or deletion lifted green. */
const LOG_TONES: Record<AdminActionEntry['action'], Tone> = {
  block: 'danger',
  delete: 'warning',
  unblock: 'success',
  cancel_deletion: 'success',
  logout: 'neutral',
  badge: 'accent',
  staff_role: 'info'
};

/** A device's icon by the client it names: the desktop app, a phone, or a browser. */
function deviceIcon(client: string) {
  if (/voiceroom|desktop|electron/i.test(client)) return AppWindow;
  if (/iphone|android|mobile|ios/i.test(client)) return Smartphone;
  return Globe;
}

export function AccountCard({ userId, onBack }: { userId: string; onBack: () => void }) {
  const canModerate = useCan('accounts.moderate');
  const canManage = useCan('accounts.manage');
  const {
    data: detail,
    failure,
    busy: loading,
    heardAt,
    reload,
    update
  } = useAdminResource(() => fetchAccount(userId), [userId], { failureText: 'Не удалось загрузить аккаунт' });
  const now = heardAt ?? 0;
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<'block' | 'delete' | 'sign-out' | null>(null);

  const closeDialog = useCallback(() => setDialog(null), []);
  // The top bar names the account once it is known.
  usePageTitle(detail ? detail.account.displayName || detail.account.login : null);

  /** Runs one action; the answer is the card as it is now. */
  async function run(action: () => Promise<AccountDetail>, fallback: string): Promise<string | null> {
    setBusy(true);
    setActionError('');
    try {
      const changed = await action();
      update(() => changed);
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

  // A retry shows the card loading again until its answer.
  if (failure && !detail && !loading) {
    return (
      <>
        {back}
        <Notice failure={failure} onRetry={reload} />
      </>
    );
  }
  if (!detail) {
    return (
      <>
        {back}
        <div className="card-loading" aria-busy="true" aria-label="Загружаем аккаунт">
          <Skeleton height={104} />
          <Skeleton height={86} />
          <Skeleton height={220} />
        </div>
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
      <div className="card-layout">
        <div className="card-main">
          <section className="card-head" aria-label="Аккаунт">
            <div className="card-identity">
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
              <div className="card-names">
                <div className="card-name-line">
                  <h2>
                    {name}
                    <AccountBadge key={account.badge ?? 'none'} userId={account.id} />
                  </h2>
                  {account.online ? <Pill tone="success">в сети</Pill> : null}
                  {account.admin ? <Pill tone="accent">сотрудник</Pill> : null}
                  {account.badge === 'official' ? <Pill tone="accent">официальный аккаунт</Pill> : null}
                  {account.status === 'blocked' ? <Pill tone="danger">заблокирован</Pill> : null}
                  {account.status === 'deleting' ? <Pill tone="danger">удаляется</Pill> : null}
                </div>
                <div className="card-meta">
                  <span className="card-login ui-mono">@{account.login}</span>
                  <span className="ui-mono" title="id аккаунта">
                    id {account.id}
                  </span>
                  <span>{account.online ? 'в сети сейчас' : `был(а) ${formatAgo(account.lastSeenAt, now)}`}</span>
                </div>
              </div>
            </div>
            {detail.deletion ? (
              <div className="card-banner" data-tone="warning" role="status">
                <Trash2 size={16} aria-hidden="true" />
                <span className="card-banner-text">
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
              <div className="card-banner" data-tone="danger" role="status">
                <Ban size={16} aria-hidden="true" />
                <span className="card-banner-text">
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
          </section>
          {actionError ? (
            <p className="admin-error" role="alert">
              {actionError}
            </p>
          ) : null}

          <Stats label="Цифры" min={150}>
            <Stat label="Регистрация" value={formatNumericDate(account.createdAt)} />
            <Stat label="Последний визит" value={account.online ? 'сейчас' : formatAgo(account.lastSeenAt, now)} />
            <Stat
              label="Активных дней за 90 дней"
              value={formatCount(account.activeDays)}
              note={clients.length ? clients.join(', ') : 'нет данных о клиентах'}
            />
            <Stat label="В войсе за 90 дней" value={formatMinutes(account.voiceMinutes)} />
            <Stat label="Сообщений" value={formatCount(account.messages)} />
            <Stat
              label="Комнаты"
              value={formatCount(account.ownedRooms)}
              note={`своих · участник в ${formatCount(detail.memberOf)}`}
            />
            <Stat
              label="Жалобы на аккаунт"
              value={formatCount(detail.reports.against)}
              tone={detail.reports.against > 0 ? 'danger' : undefined}
              note={`${detail.reports.againstOpen ? `открытых: ${detail.reports.againstOpen}` : 'открытых нет'} · от аккаунта: ${formatCount(detail.reports.filed)}`}
            />
          </Stats>

          <div className="ui-grid" style={{ '--grid-min': '380px' }}>
            <TimeChart
              title="Сообщения за 90 дней"
              kind="bar"
              height={150}
              labels={labels}
              series={[{ name: 'Сообщения', values: days.map((day) => day.messages), color: 'var(--vr-accent)' }]}
              note={`Активных дней: ${activeInSpan} из ${days.length}.`}
            />
            <TimeChart
              title="Войс за 90 дней"
              kind="bar"
              height={150}
              labels={labels}
              // In hours, so the axis marks round hours rather than odd minutes.
              format={formatHours}
              series={[
                { name: 'В войсе', values: days.map((day) => day.voiceMinutes / 60), color: 'var(--vr-success)' }
              ]}
            />
          </div>

          <Panel title="История действий администраторов">
            {detail.actions.length === 0 ? (
              <Empty>Пока ничего</Empty>
            ) : (
              <ol className="card-log">
                {detail.actions.map((entry) => (
                  <li key={entry.id}>
                    <span className="card-log-rail" aria-hidden="true">
                      <span className="card-log-dot" data-tone={LOG_TONES[entry.action]} />
                      <span className="card-log-line" />
                    </span>
                    <span className="card-log-body">
                      <span className="card-log-what">{describeAction(entry)}</span>
                      {entry.reason ? <span className="card-log-reason">«{entry.reason}»</span> : null}
                      <span className="card-log-meta">
                        {formatDateTime(entry.at)} · {entry.adminName}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>

        <div className="card-side">
          <Panel title="Действия">
            {canManage ? (
              <div className="card-official">
                <BadgeCheck size={18} aria-hidden="true" />
                <span>
                  <strong>Официальный аккаунт</strong>
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
              <p className="card-quiet">
                <Lock size={14} aria-hidden="true" /> Это аккаунт сотрудника: заблокировать, разлогинить или удалить его
                нельзя.
              </p>
            ) : (
              <div className="card-actions">
                {canModerate && account.status === 'active' ? (
                  <Button disabled={busy} onClick={() => setDialog('block')}>
                    <Ban size={16} aria-hidden="true" />
                    Заблокировать…
                  </Button>
                ) : null}
                {canModerate ? (
                  <Button disabled={busy || detail.devices.length === 0} onClick={() => setDialog('sign-out')}>
                    <LogOut size={16} aria-hidden="true" />
                    Разлогинить везде
                  </Button>
                ) : null}
                {canManage && !detail.deletion ? (
                  <Button variant="danger-outline" disabled={busy} onClick={() => setDialog('delete')}>
                    <Trash2 size={16} aria-hidden="true" />
                    Удалить аккаунт…
                  </Button>
                ) : null}
              </div>
            )}
          </Panel>

          <Panel title="Устройства со входом">
            {detail.devices.length === 0 ? (
              <Empty>Ни одного открытого сеанса</Empty>
            ) : (
              <ul className="card-list">
                {detail.devices.map((device, index) => {
                  const Icon = deviceIcon(device.client);
                  return (
                    <li key={index}>
                      <span className="card-list-icon" aria-hidden="true">
                        <Icon size={16} />
                      </span>
                      <span className="card-list-name">
                        {[device.client || 'Неизвестный клиент', device.os].filter(Boolean).join(' · ')}
                      </span>
                      <span className="card-list-note">{formatAgo(device.lastSeenAt, now)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title="Свои постоянные комнаты">
            {detail.ownedRooms.length === 0 ? (
              <Empty>Нет</Empty>
            ) : (
              <ul className="card-list">
                {detail.ownedRooms.map((room) => (
                  <li key={room.id}>
                    <RoomAvatar roomId={room.id} name={room.name || null} size={32} />
                    <span className="card-list-name">{room.name || 'Без названия'}</span>
                    <span className="card-list-note">
                      {formatCount(room.members)} {plural(room.members, ['участник', 'участника', 'участников'])}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <AccountBlockDialog open={dialog === 'block'} name={name} onClose={closeDialog} onConfirm={confirmBlock} />
      <AccountDeleteDialog
        open={dialog === 'delete'}
        login={account.login}
        onClose={closeDialog}
        onConfirm={confirmDelete}
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
        <p className="card-confirm">
          Все сеансы <strong>{name}</strong> завершатся, звонок прервётся. Войти снова можно будет с паролем — это не
          блокировка.
        </p>
      </Dialog>
    </>
  );
}
