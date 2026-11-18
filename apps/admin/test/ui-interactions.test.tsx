import { StrictMode, useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { Dialog, Popover, Segment } from '../src/ui/index.tsx';
import { GlobalSearch } from '../src/shell/GlobalSearch.tsx';
import { TimeRangePicker } from '../src/TimeRangePicker.tsx';
import { PRODUCT_PRESETS, type TimeRange } from '../src/time-range.ts';
import { renderAs } from './helpers/harness.tsx';

afterEach(cleanup);

test('global search shortcut cannot leave an open modal', async () => {
  renderAs(
    <>
      <GlobalSearch onOpenAccount={() => {}} onOpenRoom={() => {}} />
      <Dialog open title="Modal" onClose={() => {}}>
        <input aria-label="Reason" />
      </Dialog>
    </>
  );
  const modal = screen.getByRole('dialog', { name: 'Modal' });
  await userEvent.keyboard('{Control>}k{/Control}');
  expect(modal.contains(document.activeElement)).toBe(true);
});

test('changing close callback does not reset focus while typing in StrictMode', async () => {
  function Form() {
    const [value, setValue] = useState('');
    return (
      <Dialog open title="Edit" onClose={() => {}}>
        <input aria-label="First" />
        <input aria-label="Second" value={value} onChange={(event) => setValue(event.target.value)} />
      </Dialog>
    );
  }
  render(
    <StrictMode>
      <Form />
    </StrictMode>
  );
  const second = screen.getByRole<HTMLInputElement>('textbox', { name: 'Second' });
  await userEvent.type(second, 'draft');
  expect(document.activeElement).toBe(second);
  expect(second.value).toBe('draft');
});

test('closing and reopening remounts form state with one close notification', async () => {
  const closed = vi.fn();
  function Form() {
    const [value, setValue] = useState('');
    return <input aria-label="Draft" value={value} onChange={(event) => setValue(event.target.value)} />;
  }
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open</button>
        <Dialog
          open={open}
          title="Form"
          onClose={() => {
            closed();
            setOpen(false);
          }}
        >
          <Form />
        </Dialog>
      </>
    );
  }
  render(
    <StrictMode>
      <Harness />
    </StrictMode>
  );
  await userEvent.click(screen.getByRole('button', { name: 'Open' }));
  await userEvent.type(screen.getByRole('textbox'), 'saved nowhere');
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
  expect(closed).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'Open' }));
  expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe('');
});

function Popup() {
  return (
    <>
      <Popover label="Dates" trigger={({ toggle }) => <button onClick={toggle}>Dates</button>}>
        {(close) => (
          <>
            <input aria-label="Date" type="date" />
            <button onClick={close}>Apply</button>
          </>
        )}
      </Popover>
      <button>Outside</button>
    </>
  );
}

for (const action of ['Escape', 'Apply'] as const) {
  test(`popover restores trigger on ${action}`, async () => {
    render(<Popup />);
    const trigger = screen.getByRole('button', { name: 'Dates' });
    await userEvent.click(trigger);
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByLabelText('Date'));
    if (action === 'Escape') await userEvent.keyboard('{Escape}');
    else await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
}

test('outside dismissal retains the clicked destination focus', async () => {
  render(<Popup />);
  await userEvent.click(screen.getByRole('button', { name: 'Dates' }));
  await userEvent.tab();
  const outside = screen.getByRole('button', { name: 'Outside' });
  await userEvent.click(outside);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(outside);
});

test('independent radio groups support arrows without changing the other group', async () => {
  function Choices({ label }: { label: string }) {
    const [value, setValue] = useState('one');
    return (
      <Segment
        ariaLabel={label}
        options={[
          { value: 'one', label: 'One' },
          { value: 'two', label: 'Two' }
        ]}
        value={value}
        onChange={setValue}
      />
    );
  }
  render(
    <>
      <Choices label="First" />
      <Choices label="Second" />
    </>
  );
  const first = within(screen.getByRole('radiogroup', { name: 'First' }));
  const second = within(screen.getByRole('radiogroup', { name: 'Second' }));
  await userEvent.tab();
  await userEvent.keyboard('{ArrowRight}');
  expect(first.getByRole('radio', { name: 'Two', checked: true })).toBe(document.activeElement);
  await userEvent.keyboard('{ArrowRight}');
  expect(first.getByRole('radio', { name: 'One', checked: true })).toBe(document.activeElement);
  await userEvent.keyboard('{ArrowLeft}');
  expect(first.getByRole('radio', { name: 'Two', checked: true })).toBe(document.activeElement);
  expect(second.getByRole('radio', { name: 'One', checked: true })).toBeTruthy();
});

test('custom dates preserve zero checked presets through focus until explicit selection', async () => {
  const changed = vi.fn<(next: TimeRange) => void>();
  function Range() {
    const [value, setValue] = useState<TimeRange>({ kind: 'preset', id: '7d' });
    return (
      <TimeRangePicker
        value={value}
        presets={PRODUCT_PRESETS}
        withTime={false}
        onChange={(next) => {
          changed(next);
          setValue(next);
        }}
      />
    );
  }
  render(<Range />);
  await userEvent.click(screen.getByRole('button', { name: 'Свой период' }));
  await userEvent.click(screen.getByRole('button', { name: 'Показать' }));
  expect(changed.mock.lastCall?.[0].kind).toBe('custom');
  const group = within(screen.getByRole('radiogroup', { name: 'Период' }));
  expect(group.queryAllByRole('radio', { checked: true })).toHaveLength(0);
  changed.mockClear();
  group.getByRole('radio', { name: '7 дней' }).focus();
  await userEvent.tab();
  expect(changed).not.toHaveBeenCalled();
  expect(group.queryAllByRole('radio', { checked: true })).toHaveLength(0);
  await userEvent.click(group.getByRole('radio', { name: '14 дней' }));
  expect(changed).toHaveBeenLastCalledWith({ kind: 'preset', id: '14d' });
});

test('StrictMode cleanup and stale close events do not notify a live modal', () => {
  const close = vi.fn();
  const view = render(
    <StrictMode>
      <Dialog open title="Lifecycle" onClose={close}>
        <input aria-label="Value" />
      </Dialog>
    </StrictMode>
  );
  expect(close).not.toHaveBeenCalled();
  fireEvent(screen.getByRole('dialog'), new Event('close'));
  expect(close).not.toHaveBeenCalled();
  view.rerender(
    <StrictMode>
      <Dialog open={false} title="Lifecycle" onClose={close}>
        <input aria-label="Value" />
      </Dialog>
    </StrictMode>
  );
  expect(close).not.toHaveBeenCalled();
  view.rerender(
    <StrictMode>
      <Dialog open title="Lifecycle" onClose={close}>
        <input aria-label="Value" />
      </Dialog>
    </StrictMode>
  );
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(close).not.toHaveBeenCalled();
});

// Safari does not focus buttons on pointer activation.
test('popover restores the actual trigger when opening did not focus it', async () => {
  render(<Popup />);
  const outside = screen.getByRole('button', { name: 'Outside' });
  outside.focus();
  const trigger = screen.getByRole('button', { name: 'Dates' });
  fireEvent.click(trigger);
  expect(document.activeElement).toBe(outside);
  screen.getByLabelText('Date').focus();
  await userEvent.keyboard('{Escape}');
  expect(document.activeElement).toBe(trigger);
});

test('nested popover consumes Escape before its parent modal', async () => {
  const closed = vi.fn();
  const parentKey = vi.fn();
  render(
    <div onKeyDown={parentKey}>
      <Dialog open title="Parent" onClose={closed}>
        <Popup />
      </Dialog>
    </div>
  );
  await userEvent.click(screen.getByRole('button', { name: 'Dates' }));
  screen.getByLabelText('Date').focus();
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  fireEvent(screen.getByLabelText('Date'), escape);
  expect(escape.defaultPrevented).toBe(true);
  expect(parentKey).not.toHaveBeenCalled();
  expect(closed).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog', { name: 'Dates' })).toBeNull();
  expect(screen.getByRole('dialog', { name: 'Parent' })).toBeTruthy();
});

test('invalid custom range stays editable and focused until corrected', async () => {
  const changed = vi.fn<(range: TimeRange) => void>();
  render(
    <TimeRangePicker
      value={{ kind: 'preset', id: '7d' }}
      presets={PRODUCT_PRESETS}
      withTime={false}
      onChange={changed}
    />
  );
  await userEvent.click(screen.getByRole('button', { name: 'Свой период' }));
  const from = screen.getByLabelText('С');
  const to = screen.getByLabelText('По');
  fireEvent.change(from, { target: { value: '2026-11-16' } });
  fireEvent.change(to, { target: { value: '2026-11-15' } });
  const apply = screen.getByRole('button', { name: 'Показать' });
  await userEvent.click(apply);
  expect(changed).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('Начало должно быть раньше конца');
  expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  expect(document.activeElement).toBe(apply);
  fireEvent.change(to, { target: { value: '2026-11-17' } });
  expect(screen.queryByRole('alert')).toBeNull();
  await userEvent.click(apply);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Свой период' }));
});

test('popover can dismiss after its opening control is removed', async () => {
  function RemovableTrigger() {
    const [visible, setVisible] = useState(true);
    return (
      <Popover
        label="Temporary"
        trigger={({ toggle }) => (visible ? <button onClick={toggle}>Open temporary</button> : null)}
      >
        {(close) => (
          <>
            <input aria-label="Content" onFocus={() => setVisible(false)} />
            <button onClick={close}>Done</button>
          </>
        )}
      </Popover>
    );
  }
  render(<RemovableTrigger />);
  await userEvent.click(screen.getByRole('button', { name: 'Open temporary' }));
  await userEvent.tab();
  expect(screen.queryByRole('button', { name: 'Open temporary' })).toBeNull();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
});
