// Who runs the service: every staff member with their role, a role given by
// login, and a role taken away. Only a superadmin opens this section; the
// superadmins named in the server's settings cannot be changed here.

import { useCallback, useEffect, useState, type SubmitEvent } from 'react';
import { STAFF_ROLE_LABELS, STAFF_ROLES, type StaffMember, type StaffRole } from '@voice-room/shared/contracts/staff';
import { fetchStaff, setStaffRole } from '../api/staff.ts';
import { loadFailure, type LoadFailure } from '../load-state.ts';
import { Notice } from '../Notice.tsx';
import { useStaff } from '../staff.tsx';
import { AccountBadge, Avatar, Button, Select } from '../ui/index.tsx';
import './StaffPage.css';

export function StaffPage() {
  const me = useStaff();
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [login, setLogin] = useState('');
  const [role, setRole] = useState<StaffRole>('moderator');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  // Bumped to load the list again: after a change, or a retry.
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => {
    setFailure(null);
    setVersion((value) => value + 1);
  }, []);
  useEffect(() => {
    let alive = true;
    fetchStaff().then(
      (list) => alive && setStaff(list),
      (error: unknown) => alive && setFailure(loadFailure(error, 'Не удалось загрузить сотрудников'))
    );
    return () => {
      alive = false;
    };
  }, [version]);

  async function change(target: string, next: StaffRole | null): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    try {
      await setStaffRole(target, next);
      setMessage({ tone: 'ok', text: next ? `@${target}: ${STAFF_ROLE_LABELS[next]}` : `@${target}: роль снята` });
      reload();
      return true;
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Не удалось изменить роль' });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function grant(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const target = login.trim().replace(/^@/, '');
    if (target && (await change(target, role))) setLogin('');
  }

  if (failure) return <Notice failure={failure} onRetry={reload} />;

  return (
    <section className="staff-section" aria-labelledby="staff-title">
      <h2 id="staff-title">Сотрудники</h2>
      <p className="admin-note">
        Модератор разбирает жалобы, смотрит комнаты и блокирует на время. Администратор видит ещё статистику и откуда
        заходили, блокирует навсегда, удаляет и ставит отметки. Суперадминистратор раздаёт роли.
      </p>

      <form className="staff-grant" onSubmit={(event) => void grant(event)}>
        <label className="staff-field">
          <span>Логин</span>
          <input
            value={login}
            onChange={(event) => setLogin(event.target.value)}
            placeholder="login"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="staff-field">
          <span>Роль</span>
          <Select
            value={role}
            onChange={(event) => {
              const next = STAFF_ROLES.find((value) => value === event.target.value);
              if (next) setRole(next);
            }}
          >
            {STAFF_ROLES.map((value) => (
              <option key={value} value={value}>
                {STAFF_ROLE_LABELS[value]}
              </option>
            ))}
          </Select>
        </label>
        <Button variant="primary" type="submit" disabled={busy || !login.trim()}>
          Выдать роль
        </Button>
      </form>
      {message ? (
        <p
          className={message.tone === 'ok' ? 'admin-note' : 'admin-error'}
          role={message.tone === 'error' ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      ) : null}

      {staff === null ? (
        <p className="admin-note">Загрузка…</p>
      ) : (
        <ul className="staff-list">
          {staff.map((member) => (
            <li key={member.user.id} className="staff-row">
              <Avatar
                name={member.user.displayName}
                src={member.user.avatarUrl}
                colorKey={member.user.avatarColorKey}
                background={member.user.avatarAccent}
                size={32}
              />
              <span className="staff-name">
                <strong>
                  {member.user.displayName}
                  <AccountBadge userId={member.user.id} />
                </strong>
                <small>@{member.user.login}</small>
              </span>
              <span className="staff-role">{STAFF_ROLE_LABELS[member.role]}</span>
              {member.fixed ? (
                <span className="staff-quiet">задан в настройках</span>
              ) : member.user.id === me.user.id ? (
                <span className="staff-quiet">это вы</span>
              ) : (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void change(member.user.login, null)}
                  aria-label={`Снять роль с @${member.user.login}`}
                >
                  Снять роль
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
