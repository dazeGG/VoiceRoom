import { createApp } from 'vue';
import { createPinia } from 'pinia';
import type { Staff } from '../../src/staff.store.ts';
import AccountDialogsFixture from './AccountDialogsFixture.vue';
import { TimeRangePicker } from '../../src/legacy-components.tsx';
import { PRODUCT_PRESETS, type TimeRange } from '../../src/time-range';
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Dialog, Popover, Segment, Button } from '../../src/ui/index.tsx';
import { GlobalSearch } from '../../src/shell/GlobalSearch';
import { Sidebar } from '../../src/shell/Sidebar';
import { StaffContext, useStaff } from '../../src/staff';
import '../../src/pages/ProductPage.css';
import '../../src/styles/app.css';
import '../../src/styles/main.scss';
import '../../src/shell/shell.css';

const fixtureStaff: Staff = {
  user: {
    id: 'fixture',
    login: 'fixture',
    displayName: 'Fixture',
    avatarUrl: null,
    avatarColorKey: 'blue',
    avatarAccent: null
  },
  role: 'admin',
  permissions: ['accounts.view'],
  siteUrl: 'http://127.0.0.1:15180'
};

function Navigation() {
  const staff = useStaff();
  return (
    <Sidebar
      staff={staff}
      tabs={['overview', 'accounts']}
      current="accounts"
      openReports={0}
      onSelect={() => {}}
      onSignOut={() => {}}
    />
  );
}
function VueAccountDialogs() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const app = createApp(AccountDialogsFixture, { staff: fixtureStaff });
    app.use(createPinia());
    app.mount(host.current);
    return () => app.unmount();
  }, []);
  return <div ref={host} />;
}

function Fixture() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('a');
  const [range, setRange] = useState<TimeRange>({ kind: 'preset', id: '7d' });
  return (
    <StaffContext.Provider value={fixtureStaff}>
      <Navigation />
      <main className="admin-legacy" style={{ padding: 24, marginLeft: 240 }}>
        <div className="ui-table-scroll" data-testid="retention-scroll" style={{ background: 'var(--vr-surface)' }}>
          <table className="product-table">
            <thead>
              <tr>
                <th scope="col">Неделя</th>
                <th scope="col">Аккаунтов</th>
                <th scope="col">Вернулись на 1–7 день</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>с 01.11.2026</td>
                <td className="ui-num">120</td>
                <td>75%</td>
              </tr>
            </tbody>
          </table>
        </div>
        <GlobalSearch onOpenAccount={() => {}} onOpenRoom={() => {}} />
        <Button onClick={() => setOpen(true)}>Open modal</Button>
        <Segment
          ariaLabel="Period"
          value={value}
          onChange={setValue}
          options={[
            { value: 'a', label: 'Day' },
            { value: 'b', label: 'Week' }
          ]}
        />
        <Popover label="Dates" trigger={({ toggle }) => <Button onClick={toggle}>Dates</Button>}>
          {(close) => (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                close();
              }}
            >
              <input aria-label="Date" type="date" />
              <Button type="submit">Apply</Button>
            </form>
          )}
        </Popover>
        <Button>Outside</Button>
        <TimeRangePicker value={range} onChange={setRange} presets={PRODUCT_PRESETS} withTime={false} />
        <output aria-label="Range">{range.kind}</output>
        <Dialog open={open} title="Fixture modal" onClose={() => setOpen(false)}>
          <input aria-label="Reason" />
          <Button onClick={() => setOpen(false)}>Done</Button>
        </Dialog>
      </main>
      <VueAccountDialogs />
    </StaffContext.Provider>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture root');
createRoot(root).render(
  <StrictMode>
    <Fixture />
  </StrictMode>
);
