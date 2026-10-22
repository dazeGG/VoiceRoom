// The admin app: who is signed in, the sections their role opens, and the
// address that keeps the section (and an account's card) across reloads.
// The frame around the sections is the menu on the left and the top bar.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api/client.ts';
import { fetchOpenReports } from './api/admin.ts';
import { fetchMe, signOut } from './api/staff.ts';
import { FrameContext, type Frame, type RefreshStatus } from './frame.tsx';
import { AccountsPage } from './pages/AccountsPage.tsx';
import { FeedbackPage } from './pages/FeedbackPage.tsx';
import { OverviewPage } from './pages/OverviewPage.tsx';
import { ProductPage } from './pages/ProductPage.tsx';
import { ReportsPage } from './pages/ReportsPage.tsx';
import { RoomsPage, type HistoryRoom } from './pages/RoomsPage.tsx';
import { StaffPage } from './pages/StaffPage.tsx';
import { SystemPage } from './pages/SystemPage.tsx';
import { GlobalSearch } from './shell/GlobalSearch.tsx';
import { Sidebar } from './shell/Sidebar.tsx';
import { Topbar } from './shell/Topbar.tsx';
import './shell/shell.css';
import { StaffContext, type Staff } from './staff.tsx';
import {
  TAB_GROUPS,
  TAB_LABELS,
  TAB_TITLES,
  allowedTabs,
  locationFromPath,
  pathOf,
  type AdminLocation,
  type AdminTab
} from './tabs.ts';
import { Button } from './ui/index.tsx';

function useLocation(): [AdminLocation, (next: AdminLocation, replace?: boolean) => void] {
  const [location, setLocation] = useState(() => locationFromPath(window.location.pathname));
  useEffect(() => {
    const onPop = () => setLocation(locationFromPath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = useCallback((next: AdminLocation, replace = false) => {
    const path = pathOf(next);
    if (window.location.pathname !== path) {
      if (replace) window.history.replaceState(null, '', path);
      else window.history.pushState(null, '', path);
    }
    setLocation(next);
  }, []);
  return [location, go];
}

const groupOf = (tab: AdminTab) => TAB_GROUPS.find((group) => group.tabs.includes(tab))?.label ?? '';

export function App() {
  const [staff, setStaff] = useState<Staff | null>(null);
  const [failed, setFailed] = useState('');
  const [location, go] = useLocation();
  const [openReports, setOpenReports] = useState(0);
  const [pageTitle, setPageTitle] = useState<string | null>(null);
  const [refresh, setRefresh] = useState<RefreshStatus | null>(null);
  const [frame] = useState<Frame>(() => ({ setTitle: setPageTitle, setRefresh }));
  // A room picked in the search: the rooms section narrows its history to it.
  const [roomFocus, setRoomFocus] = useState<HistoryRoom | null>(null);
  const main = useRef<HTMLElement>(null);

  useEffect(() => {
    fetchMe().then(
      ({ ok: _ok, ...me }) => setStaff(me),
      (error: unknown) => {
        // A lost session already went back through the handoff (client.ts).
        if (!(error instanceof ApiError && error.code === 'staff_session_required')) {
          setFailed(error instanceof Error ? error.message : 'Не удалось открыть админку');
        }
      }
    );
  }, []);

  const tabs = staff ? allowedTabs(staff.permissions) : [];
  const canReview = staff?.permissions.includes('reports.review') ?? false;

  useEffect(() => {
    if (!canReview) return;
    const load = () =>
      void fetchOpenReports().then(
        (reports) => setOpenReports(reports.length),
        () => {}
      );
    load();
    const timer = window.setInterval(load, 60_000);
    return () => window.clearInterval(timer);
  }, [canReview]);

  // An address the role cannot open lands on the first section it can.
  const first = tabs[0];
  const tab: AdminTab | undefined = tabs.includes(location.tab) ? location.tab : first;
  useEffect(() => {
    if (tab && tab !== location.tab) go({ tab, accountId: null }, true);
  }, [tab, location.tab, go]);

  // Another section (or another account) starts at its top.
  useEffect(() => {
    main.current?.scrollTo?.({ top: 0 });
  }, [tab, location.accountId]);

  if (failed) {
    return (
      <main className="admin-failed">
        <p className="admin-error" role="alert">
          {failed}
        </p>
        <Button onClick={() => window.location.reload()}>Повторить</Button>
      </main>
    );
  }
  if (!staff || !tab) return <main className="admin-loading">Загрузка…</main>;

  const selectTab = (next: AdminTab) => go({ tab: next, accountId: null });
  const openAccount = (accountId: string | null) => go({ tab: 'accounts', accountId });
  const onCard = tab === 'accounts' && location.accountId !== null;

  return (
    <StaffContext.Provider value={staff}>
      <FrameContext.Provider value={frame}>
        <div className="frame">
          <Sidebar
            staff={staff}
            tabs={tabs}
            current={tab}
            openReports={openReports}
            onSelect={(next) => {
              // The menu opens a section as it is, not narrowed to the last room searched for.
              setRoomFocus(null);
              selectTab(next);
            }}
            onSignOut={() => void signOut().finally(() => window.location.assign(staff.siteUrl))}
          />
          <div className="frame-column">
            <Topbar
              crumb={onCard ? TAB_LABELS.accounts : groupOf(tab)}
              title={onCard ? (pageTitle ?? 'Аккаунт') : TAB_TITLES[tab]}
              refresh={refresh}
              search={
                <GlobalSearch
                  onOpenAccount={openAccount}
                  onOpenRoom={(room) => {
                    setRoomFocus(room);
                    selectTab('rooms');
                  }}
                />
              }
            />
            <main className="frame-main" ref={main}>
              <div className="frame-content">
                {tab === 'overview' ? <OverviewPage onOpenReports={() => selectTab('reports')} /> : null}
                {tab === 'product' ? <ProductPage /> : null}
                {tab === 'system' ? <SystemPage /> : null}
                {tab === 'accounts' ? (
                  <AccountsPage accountId={location.accountId} onOpenAccount={openAccount} />
                ) : null}
                {tab === 'rooms' ? <RoomsPage onOpenAccount={openAccount} focusRoom={roomFocus} /> : null}
                {tab === 'reports' ? <ReportsPage onResolved={setOpenReports} /> : null}
                {tab === 'feedback' ? <FeedbackPage /> : null}
                {tab === 'staff' ? <StaffPage /> : null}
              </div>
            </main>
          </div>
        </div>
      </FrameContext.Provider>
    </StaffContext.Provider>
  );
}
