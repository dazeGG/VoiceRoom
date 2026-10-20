// The admin app: who is signed in, the sections their role opens, and the
// address that keeps the section (and an account's card) across reloads.

import { LogOut } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { STAFF_ROLE_LABELS } from '@voice-room/shared/contracts/staff';
import { ApiError } from './api/client.ts';
import { fetchOpenReports } from './api/admin.ts';
import { fetchMe, signOut } from './api/staff.ts';
import { AccountsPage } from './pages/AccountsPage.tsx';
import { FeedbackPage } from './pages/FeedbackPage.tsx';
import { OverviewPage } from './pages/OverviewPage.tsx';
import { ProductPage } from './pages/ProductPage.tsx';
import { ReportsPage } from './pages/ReportsPage.tsx';
import { RoomsPage } from './pages/RoomsPage.tsx';
import { StaffPage } from './pages/StaffPage.tsx';
import { SystemPage } from './pages/SystemPage.tsx';
import { StaffContext, type Staff } from './staff.tsx';
import { TAB_LABELS, allowedTabs, locationFromPath, pathOf, type AdminLocation, type AdminTab } from './tabs.ts';
import { Avatar, Button, Segment } from './ui/index.tsx';

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

export function App() {
  const [staff, setStaff] = useState<Staff | null>(null);
  const [failed, setFailed] = useState('');
  const [location, go] = useLocation();
  const [openReports, setOpenReports] = useState(0);

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

  if (failed) {
    return (
      <main className="admin-shell">
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

  return (
    <StaffContext.Provider value={staff}>
      <main className="admin-shell">
        <header className="admin-head">
          <h1>Админка</h1>
          <Segment
            kind="tabs"
            ariaLabel="Разделы"
            value={tab}
            onChange={selectTab}
            options={tabs.map((value) => ({
              value,
              label: TAB_LABELS[value],
              suffix:
                value === 'reports' && openReports > 0 ? (
                  <span className="admin-tab-count" aria-label={`открытых: ${openReports}`}>
                    {openReports}
                  </span>
                ) : undefined
            }))}
          />
          <span className="admin-who">
            <Avatar
              name={staff.user.displayName}
              src={staff.user.avatarUrl}
              colorKey={staff.user.avatarColorKey}
              background={staff.user.avatarAccent}
              size={24}
            />
            {staff.user.displayName} · {STAFF_ROLE_LABELS[staff.role]}
            <Button
              variant="ghost"
              aria-label="Выйти из админки"
              title="Выйти из админки"
              onClick={() => void signOut().finally(() => window.location.assign(staff.siteUrl))}
            >
              <LogOut size={16} aria-hidden="true" />
            </Button>
          </span>
        </header>
        <div className="admin-body" role="tabpanel">
          {tab === 'overview' ? <OverviewPage onOpenReports={() => selectTab('reports')} /> : null}
          {tab === 'product' ? <ProductPage /> : null}
          {tab === 'system' ? <SystemPage /> : null}
          {tab === 'accounts' ? <AccountsPage accountId={location.accountId} onOpenAccount={openAccount} /> : null}
          {tab === 'rooms' ? <RoomsPage onOpenAccount={openAccount} /> : null}
          {tab === 'reports' ? <ReportsPage onResolved={setOpenReports} /> : null}
          {tab === 'feedback' ? <FeedbackPage /> : null}
          {tab === 'staff' ? <StaffPage /> : null}
        </div>
      </main>
    </StaffContext.Provider>
  );
}
