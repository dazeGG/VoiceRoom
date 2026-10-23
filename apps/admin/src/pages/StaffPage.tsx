// Who runs the service: every staff member with their role, a role given by
// login, and a role taken away; beside them who may do what, as a summary and
// as a full table worked out from the roles themselves. Only a superadmin
// opens this section; the superadmins named in the server's settings cannot
// be changed here.

import { Check, Lock, Minus, Table2 } from 'lucide-react';
import { useCallback, useState, type SubmitEvent } from 'react';
import {
  ROLE_PERMISSIONS,
  STAFF_PERMISSIONS,
  STAFF_ROLE_LABELS,
  STAFF_ROLES,
  type StaffMember,
  type StaffRole
} from '@voice-room/shared/contracts/staff';
import { fetchStaff, setStaffRole } from '../api/staff.ts';
import { formatPeople } from '../format.ts';
import { useAdminResource } from '../load-state.ts';
import { Notice } from '../Notice.tsx';
import { useStaff } from '../staff.tsx';
import { permissionGroups, rolesAreNested, sectionsOf } from '../staff-permissions.ts';
import { AccountBadge, Avatar, Button, Dialog, Empty, Panel, Pill, Select, type Tone } from '../ui/index.tsx';
import './StaffPage.css';

const ROLE_TONES: Record<StaffRole, Tone> = { superadmin: 'accent', admin: 'info', moderator: 'neutral' };
const ROLE_COLORS: Record<StaffRole, string> = {
  superadmin: 'var(--vr-accent)',
  admin: 'var(--vr-info)',
  moderator: 'var(--vr-text-2)'
};

/** The roles from the most to the least, as the list and the table read them. */
const RANKED = [...STAFF_ROLES].reverse();

function RolePill({ role }: { role: StaffRole }) {
  return <Pill tone={ROLE_TONES[role]}>{STAFF_ROLE_LABELS[role]}</Pill>;
}

function RightsTable({ staff }: { staff: readonly StaffMember[] | null }) {
  const count = (role: StaffRole) => staff?.filter((member) => member.role === role).length ?? null;
  const columns = `minmax(280px, 1fr) repeat(${String(RANKED.length)}, minmax(120px, 150px))`;
  return (
    <div className="rights" role="table" aria-label="Права ролей">
      <div className="rights-row rights-head" role="row" style={{ '--cols': columns }}>
        <span role="columnheader">Право</span>
        {RANKED.map((role) => {
          const people = count(role);
          return (
            <span key={role} role="columnheader" className="rights-role">
              <RolePill role={role} />
              {people !== null ? <small>{formatPeople(people)}</small> : null}
            </span>
          );
        })}
      </div>
      {permissionGroups().map((group) => (
        <div key={group.label} role="rowgroup" aria-label={group.label}>
          <div className="rights-group" role="row">
            <span role="rowheader">{group.label}</span>
          </div>
          {group.rows.map((row) => (
            <div key={row.permission} className="rights-row" role="row" style={{ '--cols': columns }}>
              <span role="rowheader" className="rights-title">
                {row.title}
                {row.opens ? <small>{row.opens}</small> : null}
              </span>
              {RANKED.map((role) => (
                <span key={role} role="cell" className="rights-cell">
                  {row.roles[role] ? (
                    <span className="rights-yes" aria-label="может" title="может">
                      <Check size={16} aria-hidden="true" />
                    </span>
                  ) : (
                    <span className="rights-no" aria-label="не может" title="не может">
                      <Minus size={16} aria-hidden="true" />
                    </span>
                  )}
                </span>
              ))}
            </div>
          ))}
        </div>
      ))}
      <div className="rights-row rights-sections" role="row" style={{ '--cols': columns }}>
        <span role="rowheader" className="rights-title">
          Разделы в меню
        </span>
        {RANKED.map((role) => (
          <span key={role} role="cell" className="rights-cell">
            {sectionsOf(role).join(', ')}
          </span>
        ))}
      </div>
    </div>
  );
}

export function StaffPage() {
  const me = useStaff();
  // Loaded again after a change, or a retry.
  const {
    data: staff,
    failure,
    busy: loading,
    reload
  } = useAdminResource(fetchStaff, [], { failureText: 'Не удалось загрузить сотрудников' });
  const [login, setLogin] = useState('');
  const [role, setRole] = useState<StaffRole>('moderator');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [rightsOpen, setRightsOpen] = useState(false);

  const closeRights = useCallback(() => setRightsOpen(false), []);

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

  // A failed load says so until the next request; the list shows again while that one is out.
  if (failure && !loading) return <Notice failure={failure} onRetry={reload} />;

  const total = STAFF_PERMISSIONS.length;
  return (
    <div className="staff-layout">
      <Panel title="Сотрудники" aside={staff ? formatPeople(staff.length) : null} flush className="staff-main">
        {staff === null ? (
          <p className="ui-empty" aria-busy="true">
            Загружаем…
          </p>
        ) : staff.length === 0 ? (
          <Empty>Сотрудников пока нет</Empty>
        ) : (
          <ul className="staff-list" aria-label="Сотрудники">
            {staff.map((member) => (
              <li key={member.user.id} className="staff-row">
                <Avatar
                  name={member.user.displayName}
                  src={member.user.avatarUrl}
                  colorKey={member.user.avatarColorKey}
                  background={member.user.avatarAccent}
                  size={36}
                />
                <span className="staff-name">
                  <strong>
                    {member.user.displayName}
                    <AccountBadge userId={member.user.id} />
                  </strong>
                  <small className="ui-mono">@{member.user.login}</small>
                </span>
                <span className="staff-role">
                  <RolePill role={member.role} />
                </span>
                <span className="staff-act">
                  {member.fixed ? (
                    <span className="staff-quiet">задан в настройках</span>
                  ) : member.user.id === me.user.id ? (
                    <span className="staff-quiet">это вы</span>
                  ) : (
                    <Button
                      variant="ghost"
                      className="staff-revoke"
                      disabled={busy}
                      onClick={() => void change(member.user.login, null)}
                      aria-label={`Снять роль с @${member.user.login}`}
                    >
                      Снять роль
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="staff-side">
        <Panel title="Выдать роль">
          <form className="staff-grant" onSubmit={(event) => void grant(event)}>
            <label className="staff-field">
              <span>Логин</span>
              <span className="staff-login">
                <span className="ui-mono" aria-hidden="true">
                  @
                </span>
                <input
                  className="ui-mono"
                  value={login}
                  onChange={(event) => setLogin(event.target.value)}
                  placeholder="login"
                  autoComplete="off"
                  spellCheck={false}
                />
              </span>
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
        </Panel>

        <Panel title="Кто что может">
          <ul className="staff-summary" aria-label="Права по ролям">
            {RANKED.map((rank) => {
              const has = ROLE_PERMISSIONS[rank].length;
              return (
                <li key={rank}>
                  <span className="staff-summary-line">
                    <strong>{STAFF_ROLE_LABELS[rank]}</strong>
                    <span>
                      {has} из {total} прав
                    </span>
                  </span>
                  <span className="staff-pips" aria-hidden="true">
                    {STAFF_PERMISSIONS.map((permission) => (
                      <span
                        key={permission}
                        style={{
                          background: ROLE_PERMISSIONS[rank].includes(permission) ? ROLE_COLORS[rank] : undefined
                        }}
                      />
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
          <Button onClick={() => setRightsOpen(true)}>
            <Table2 size={16} aria-hidden="true" />
            Таблица прав
          </Button>
        </Panel>
      </div>

      <Dialog
        open={rightsOpen}
        wide
        title="Кто что может"
        {...(rolesAreNested()
          ? { description: 'Каждая следующая роль может всё, что предыдущая, и ещё немного.' }
          : {})}
        onClose={closeRights}
        footer={
          <span className="staff-fixed-note">
            <Lock size={14} aria-hidden="true" />
            Суперадминистраторы из настроек сервера в панели не меняются.
          </span>
        }
      >
        <RightsTable staff={staff} />
      </Dialog>
    </div>
  );
}
