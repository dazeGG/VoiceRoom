// The menu on the left: the sections a role may open, in their groups, and who
// is signed in. It is pinned open or folded to its icons; folded, it opens
// over the content while the pointer (or focus) is on it. The pin lives in
// localStorage, and a narrow window starts folded.

import {
  AudioLines,
  ChevronsLeft,
  ChevronsRight,
  Flag,
  LayoutDashboard,
  LogOut,
  Server,
  ShieldCheck,
  ThumbsUp,
  TrendingUp,
  Users,
  type LucideIcon
} from 'lucide-react';
import { useState, type FocusEvent, type MouseEvent } from 'react';
import { STAFF_ROLE_LABELS } from '@voice-room/shared/contracts/staff';
import logoUrl from '../../../web/public/voiceroom-icon.svg';
import type { Staff } from '../staff.tsx';
import { TAB_GROUPS, TAB_LABELS, pathOf, type AdminTab } from '../tabs.ts';
import { Avatar } from '../ui/index.tsx';

const TAB_ICONS: Record<AdminTab, LucideIcon> = {
  overview: LayoutDashboard,
  product: TrendingUp,
  feedback: ThumbsUp,
  system: Server,
  accounts: Users,
  rooms: AudioLines,
  reports: Flag,
  staff: ShieldCheck
};

const STORAGE_KEY = 'vr-admin-sidebar-collapsed';
const NARROW_PX = 900;

function initiallyCollapsed(): boolean {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved !== null) return saved === 'true';
  } catch {
    // Storage may be off; the window's width decides then.
  }
  return window.innerWidth < NARROW_PX;
}

function remember(collapsed: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(collapsed));
  } catch {
    // Not remembered, still applied.
  }
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
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  const [peek, setPeek] = useState(false);
  const wide = !collapsed || peek;

  function toggle(): void {
    setCollapsed(!collapsed);
    remember(!collapsed);
    setPeek(false);
  }

  function select(event: MouseEvent<HTMLAnchorElement>, tab: AdminTab): void {
    // A modified click opens the section in a new tab as a plain link would.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    onSelect(tab);
  }

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setPeek(false);
  };

  const roleLabel = STAFF_ROLE_LABELS[staff.role];
  return (
    <div
      className="side-rail"
      data-collapsed={collapsed}
      data-wide={wide}
      onMouseEnter={() => collapsed && setPeek(true)}
      onMouseLeave={() => setPeek(false)}
      onFocus={() => collapsed && setPeek(true)}
      onBlur={onBlur}
    >
      <aside className="side">
        <div className="side-head">
          <img src={logoUrl} alt="" width={32} height={32} className="side-logo" />
          <span className="side-fade side-brand">
            <span className="side-brand-name">VoiceRoom</span>
            <span className="side-brand-sub">Админка</span>
          </span>
        </div>
        <nav className="side-nav" aria-label="Разделы">
          {TAB_GROUPS.map((group) => {
            const items = group.tabs.filter((tab) => tabs.includes(tab));
            if (!items.length) return null;
            return (
              <div key={group.label} className="side-group">
                <span className="side-fade side-group-label" aria-hidden="true">
                  {group.label}
                </span>
                {items.map((tab) => {
                  const Icon = TAB_ICONS[tab];
                  const badge = tab === 'reports' && openReports > 0;
                  return (
                    <a
                      key={tab}
                      href={pathOf({ tab, accountId: null })}
                      className="side-item"
                      title={TAB_LABELS[tab]}
                      aria-current={tab === current ? 'page' : undefined}
                      onClick={(event) => select(event, tab)}
                    >
                      <Icon size={18} className="side-item-icon" aria-hidden="true" />
                      <span className="side-fade side-item-text">
                        <span className="side-item-label">{TAB_LABELS[tab]}</span>
                        {badge ? (
                          <span className="side-badge" aria-label={`открытых: ${openReports}`}>
                            {openReports}
                          </span>
                        ) : null}
                      </span>
                      {badge && !wide ? <span className="side-dot" aria-hidden="true" /> : null}
                    </a>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="side-foot" title={`${staff.user.displayName} · ${roleLabel}`}>
          <Avatar
            name={staff.user.displayName}
            src={staff.user.avatarUrl}
            colorKey={staff.user.avatarColorKey}
            background={staff.user.avatarAccent}
            size={34}
          />
          <span className="side-fade side-who">
            <span className="side-who-name">{staff.user.displayName}</span>
            <span className="side-who-role">{roleLabel}</span>
          </span>
          <button
            type="button"
            className="side-fade side-sign-out"
            aria-label="Выйти из админки"
            title="Выйти из админки"
            onClick={onSignOut}
          >
            <LogOut size={16} aria-hidden="true" />
          </button>
        </div>
      </aside>
      <button
        type="button"
        className="side-pin"
        aria-label={collapsed ? 'Закрепить меню открытым' : 'Свернуть меню'}
        title={collapsed ? 'Закрепить меню открытым' : 'Свернуть меню'}
        onClick={toggle}
      >
        {collapsed ? <ChevronsRight size={14} aria-hidden="true" /> : <ChevronsLeft size={14} aria-hidden="true" />}
      </button>
    </div>
  );
}
