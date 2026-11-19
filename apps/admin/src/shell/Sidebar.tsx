// The menu on the left, drawn like the app's own lobby menu
// (apps/web/.../lobby/Sidebar.vue): the sections a role may open in their
// groups, the open reports counted, and who is signed in at the bottom. Its
// edge is dragged to a width; folded, it is a rail of icons and opens over the
// content while the mouse is on it (use-sidebar.ts).

import {
  AudioLines,
  CodeXml,
  ExternalLink,
  Flag,
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Server,
  ShieldCheck,
  ThumbsUp,
  TrendingUp,
  Users,
  type LucideIcon
} from 'lucide-react';
import { useId, type MouseEvent } from 'react';
import type { StaffRole } from '@voice-room/shared/contracts/staff';
import type { Staff } from '../staff.tsx';
import { TAB_GROUPS, TAB_LABELS, pathOf, type AdminTab } from '../tabs.ts';
import { Avatar } from '../ui/index.tsx';
import { useSidebar } from './use-sidebar.ts';
import './sidebar.css';

const TAB_ICONS: Record<AdminTab, LucideIcon> = {
  overview: LayoutDashboard,
  product: TrendingUp,
  feedback: ThumbsUp,
  system: Server,
  accounts: Users,
  rooms: AudioLines,
  widgets: CodeXml,
  reports: Flag,
  staff: ShieldCheck
};

/** The role as the profile's second line names it, short. */
const ROLE_SHORT: Record<StaffRole, string> = {
  moderator: 'модератор',
  admin: 'админ',
  superadmin: 'суперадмин'
};

const countLabel = (count: number) => (count > 99 ? '99+' : String(count));

/** The VoiceRoom mascot in the text colour (the accent, where it sits). */
function Mascot({ label }: { label?: string }) {
  // The id goes into url(#…), where React's ':' or '«' would not resolve everywhere.
  const mask = `vr-band-${useId().replace(/[^\w-]/g, '')}`;
  return (
    <svg
      className="sidebar__brand-mark"
      viewBox="0 0 100 100"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <defs>
        <mask id={mask}>
          <rect width="100" height="100" fill="white" />
          <rect x="10" y="44" width="80" height="22" fill="black" />
        </mask>
      </defs>
      <path
        d="M20 38 L20 10 L41 29 L59 29 L80 10 L80 38 Q85 46 85 56 Q85 86 50 86 Q15 86 15 56 Q15 46 20 38 Z"
        fill="currentColor"
        mask={`url(#${mask})`}
      />
      <circle cx="38" cy="55" r="6.5" fill="currentColor" />
      <circle cx="62" cy="55" r="6.5" fill="currentColor" />
    </svg>
  );
}

export function Sidebar({
  staff,
  tabs,
  current,
  openReports,
  onSelect,
  onSignOut
}: {
  staff: Staff;
  tabs: readonly AdminTab[];
  current: AdminTab;
  openReports: number;
  onSelect: (tab: AdminTab) => void;
  onSignOut: () => void;
}) {
  const menu = useSidebar();
  const sidebarId = useId();
  const toggleLabel = menu.layoutCollapsed ? 'Развернуть боковую панель' : 'Свернуть боковую панель';
  const ToggleIcon = menu.layoutCollapsed ? PanelLeftOpen : PanelLeftClose;
  const groups = TAB_GROUPS.map((group) => ({
    label: group.label,
    tabs: group.tabs.filter((tab) => tabs.includes(tab))
  })).filter((group) => group.tabs.length > 0);
  const user = staff.user;
  const avatar = (
    <Avatar
      name={user.displayName}
      src={user.avatarUrl}
      colorKey={user.avatarColorKey}
      background={user.avatarAccent}
      size={32}
    />
  );

  function select(event: MouseEvent<HTMLAnchorElement>, tab: AdminTab): void {
    // A modified click opens the section in a new tab as a plain link would.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    menu.hidePreview();
    onSelect(tab);
  }

  const badgeOf = (tab: AdminTab) => (tab === 'reports' && openReports > 0 ? openReports : 0);

  return (
    <div
      className="lobby-side"
      data-collapsed={menu.layoutCollapsed}
      data-peek={menu.peeking}
      data-resizing={menu.resizing}
      style={{ '--lv-side-w': `${String(menu.width)}px` }}
      onPointerEnter={menu.showPreview}
      onPointerLeave={menu.hidePreview}
    >
      {menu.layoutCollapsed ? (
        <nav className="lobby-side__rail" aria-label="Разделы, кратко">
          <Mascot />
          <div className="lobby-side__rail-icons">
            {groups.flatMap((group) =>
              group.tabs.map((tab) => {
                const Icon = TAB_ICONS[tab];
                const badge = badgeOf(tab);
                return (
                  <a
                    key={tab}
                    href={pathOf({ tab, accountId: null })}
                    className="lobby-side__rail-icon"
                    aria-current={tab === current ? 'page' : undefined}
                    aria-label={badge ? `${TAB_LABELS[tab]}, открытых: ${String(badge)}` : TAB_LABELS[tab]}
                    title={TAB_LABELS[tab]}
                    tabIndex={menu.visible ? -1 : undefined}
                    onClick={(event) => select(event, tab)}
                  >
                    <Icon size={18} aria-hidden="true" />
                    {badge ? (
                      <span className="ui-badge ui-badge--default lobby-side__rail-badge" aria-hidden="true">
                        {countLabel(badge)}
                      </span>
                    ) : null}
                  </a>
                );
              })
            )}
          </div>
          <div className="lobby-side__rail-account" title={user.displayName}>
            {avatar}
          </div>
        </nav>
      ) : null}
      <button
        type="button"
        className="sidebar__icon-button lobby-side__toggle"
        aria-controls={sidebarId}
        aria-expanded={menu.visible}
        aria-label={toggleLabel}
        title={toggleLabel}
        onClick={menu.toggle}
      >
        <ToggleIcon size={16} aria-hidden="true" />
      </button>
      {menu.visible ? (
        <aside className="sidebar" id={sidebarId}>
          <div className="sidebar__main">
            <div className="sidebar__top">
              <a
                href={pathOf({ tab: tabs[0] ?? 'overview', accountId: null })}
                className="sidebar__head"
                title={TAB_LABELS[tabs[0] ?? 'overview']}
                onClick={(event) => {
                  const first = tabs[0];
                  if (first) select(event, first);
                }}
              >
                <Mascot label="VoiceRoom" />
                <span className="sidebar__brand">
                  <span className="sidebar__brand-name">VoiceRoom</span>
                  <span className="sidebar__brand-sub">Админка</span>
                </span>
              </a>
            </div>
            <nav className="sidebar__scroll" aria-label="Разделы">
              {groups.map((group) => (
                <div key={group.label} className="sidebar__group">
                  <div className="sidebar__section-head">
                    <span className="sidebar__section-title">{group.label}</span>
                  </div>
                  {group.tabs.map((tab) => {
                    const Icon = TAB_ICONS[tab];
                    const badge = badgeOf(tab);
                    return (
                      <a
                        key={tab}
                        href={pathOf({ tab, accountId: null })}
                        className="sidebar__row"
                        aria-current={tab === current ? 'page' : undefined}
                        onClick={(event) => select(event, tab)}
                      >
                        <span className="sidebar__row-icon">
                          <Icon size={18} aria-hidden="true" />
                        </span>
                        <span className="sidebar__row-name">{TAB_LABELS[tab]}</span>
                        {badge ? (
                          <span className="ui-badge ui-badge--default" aria-label={`открытых: ${String(badge)}`}>
                            {countLabel(badge)}
                          </span>
                        ) : null}
                      </a>
                    );
                  })}
                </div>
              ))}
            </nav>
          </div>
          <div className="sidebar__profile">
            <span className="sidebar__profile-user">
              <span className="sidebar__avatar-wrap">
                {avatar}
                <span className="ui-avatar__dot" aria-label="в сети" role="img" />
              </span>
              <span className="sidebar__profile-names">
                <span className="sidebar__profile-name">{user.displayName}</span>
                <span className="sidebar__profile-handle">
                  @{user.login} · {ROLE_SHORT[staff.role]}
                </span>
              </span>
            </span>
            <span className="sidebar__profile-actions">
              <a
                href={staff.siteUrl}
                className="sidebar__icon-button"
                aria-label="Открыть VoiceRoom"
                title="Открыть VoiceRoom"
                target="_blank"
                rel="noopener"
              >
                <ExternalLink size={16} aria-hidden="true" />
              </a>
              <button
                type="button"
                className="sidebar__icon-button"
                aria-label="Выйти из админки"
                title="Выйти из админки"
                onClick={onSignOut}
              >
                <LogOut size={16} aria-hidden="true" />
              </button>
            </span>
          </div>
        </aside>
      ) : null}
      {menu.layoutCollapsed && !menu.resizing ? null : (
        <div
          className="lobby-side__resizer"
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-controls={sidebarId}
          aria-label="Ширина боковой панели"
          aria-valuemin={0}
          aria-valuemax={menu.maxWidth}
          aria-valuenow={menu.width}
          onPointerDown={menu.startResize}
          onPointerMove={menu.resize}
          onPointerUp={menu.finishResize}
          onPointerCancel={menu.cancelResize}
          onKeyDown={menu.resizeWithKeyboard}
        />
      )}
    </div>
  );
}
