// Temporary mount for the React pages while the admin shell moves to Vue.
import { createRoot } from 'react-dom/client';
import { FrameContext, type Frame } from './frame.tsx';
import { StaffContext, type Staff } from './staff.tsx';
import type { AdminLocation, AdminTab, CallRef } from './tabs.ts';
import { FeedbackPage } from './pages/FeedbackPage.tsx';
import { OverviewPage } from './pages/OverviewPage.tsx';
import { ProductPage } from './pages/ProductPage.tsx';
import { ReportsPage } from './pages/ReportsPage.tsx';
import { WidgetsPage } from './pages/WidgetsPage.tsx';
import { SystemPage } from './pages/SystemPage.tsx';

interface PageProps {
  staff: Staff;
  frame: Frame;
  location: AdminLocation;
  selectTab: (tab: AdminTab) => void;
  openAccount: (accountId: string | null) => void;
  openCall: (call: CallRef) => void;
  openLiveRoom: (roomId: string) => void;
  setOpenReports: (count: number) => void;
}

function Pages({ staff, frame, location, selectTab, openAccount, openCall, openLiveRoom, setOpenReports }: PageProps) {
  const { tab } = location;

  return (
    <StaffContext.Provider value={staff}>
      <FrameContext.Provider value={frame}>
        {tab === 'overview' ? (
          <OverviewPage
            onOpenReports={() => selectTab('reports')}
            onOpenTab={selectTab}
            onOpenAccount={openAccount}
            onOpenCall={openCall}
            onOpenLiveRoom={openLiveRoom}
          />
        ) : null}
        {tab === 'product' ? <ProductPage /> : null}
        {tab === 'system' ? <SystemPage /> : null}
        {tab === 'widgets' ? <WidgetsPage onOpenAccount={openAccount} onOpenCall={openCall} /> : null}
        {tab === 'reports' ? <ReportsPage onResolved={setOpenReports} onOpenAccount={openAccount} /> : null}
        {tab === 'feedback' ? <FeedbackPage /> : null}
      </FrameContext.Provider>
    </StaffContext.Provider>
  );
}

export function mountLegacyPages(host: HTMLElement) {
  const root = createRoot(host);
  return {
    render: (props: PageProps) => root.render(<Pages {...props} />),
    unmount: () => root.unmount()
  };
}
