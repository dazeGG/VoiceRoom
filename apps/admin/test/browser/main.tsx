import { AccountBlockDialog } from '../../src/pages/AccountBlockDialog';
import { AccountDeleteDialog } from '../../src/pages/AccountDeleteDialog';
import { TimeRangePicker } from '../../src/TimeRangePicker';
import { PRODUCT_PRESETS, type TimeRange } from '../../src/time-range';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Dialog, Popover, Segment, Button } from '../../src/ui';
import { GlobalSearch } from '../../src/shell/GlobalSearch';
import { Sidebar } from '../../src/shell/Sidebar';
import { StaffContext, useStaff } from '../../src/staff';
import '../../src/styles/theme.css';
import '../../src/pages/ProductPage.css';
import '../../src/styles/app.css';
import '../../src/shell/shell.css';
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
function Fixture() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('a');
  const [block, setBlock] = useState(false);
  const [remove, setRemove] = useState(false);
  const [submits, setSubmits] = useState(0);
  const [range, setRange] = useState<TimeRange>({ kind: 'preset', id: '7d' });
  return (
    <StaffContext.Provider
      value={{
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
      }}
    >
      <Navigation />
      <main style={{ padding: 24, marginLeft: 240 }}>
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
        <Button onClick={() => setBlock(true)}>Open block</Button>
        <Button onClick={() => setRemove(true)}>Open delete</Button>
        <output aria-label="Submissions">{submits}</output>
        <TimeRangePicker value={range} onChange={setRange} presets={PRODUCT_PRESETS} withTime={false} />
        <output aria-label="Range">{range.kind}</output>
        <AccountBlockDialog
          open={block}
          name="Fixture"
          onClose={() => setBlock(false)}
          onConfirm={async () => {
            setSubmits((n) => n + 1);
            setBlock(false);
            return null;
          }}
        />
        <AccountDeleteDialog
          open={remove}
          login="fixture"
          onClose={() => setRemove(false)}
          onConfirm={async () => {
            setSubmits((n) => n + 1);
            setRemove(false);
            return null;
          }}
        />
        <Dialog open={open} title="Fixture modal" onClose={() => setOpen(false)}>
          <input aria-label="Reason" />
          <Button onClick={() => setOpen(false)}>Done</Button>
        </Dialog>
      </main>
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
