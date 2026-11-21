import { fireEvent, screen, waitFor, within } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import {
  Popover,
  SegmentControl,
  type PopoverContentState,
  type PopoverTriggerState
} from '@voiceroom/ui-kit/components';
import { expect, test, vi } from 'vitest';
import { h, ref } from 'vue';
import GlobalSearch from '../src/shell/GlobalSearch.vue';
import Dialog from '../src/ui/Dialog.vue';
import { renderFixture, renderWithApp } from './helpers/render.ts';

test('global search shortcut cannot leave an open modal', async () => {
  renderFixture(() => () => [
    h(GlobalSearch),
    h(Dialog, { open: true, title: 'Modal', onClose: () => {} }, () => h('input', { 'aria-label': 'Reason' }))
  ]);
  const modal = await screen.findByRole('dialog', { name: 'Modal' });
  const reason = within(modal).getByRole('textbox', { name: 'Reason' });
  await waitFor(() => expect(document.activeElement).toBe(reason));
  await userEvent.keyboard('{Control>}k{/Control}');
  expect(modal.contains(document.activeElement)).toBe(true);
});

test('changing the close callback does not reset focus while typing', async () => {
  renderFixture(() => {
    const value = ref('');
    function write(event: Event): void {
      if (event.target instanceof HTMLInputElement) value.value = event.target.value;
    }
    return () => {
      const draft = value.value;
      return h(
        Dialog,
        {
          open: true,
          title: 'Edit',
          onClose: () => {
            value.value = draft;
          }
        },
        () => [
          h('input', { 'aria-label': 'First' }),
          h('input', { 'aria-label': 'Second', value: draft, onInput: write })
        ]
      );
    };
  });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'First' })));
  const second = screen.getByRole('textbox', { name: 'Second' });
  await userEvent.type(second, 'draft');
  expect(document.activeElement).toBe(second);
  expect(second).toHaveProperty('value', 'draft');
});

test('closing and reopening remounts form state with one close notification', async () => {
  const closed = vi.fn();
  renderFixture(() => {
    const open = ref(false);
    function close(): void {
      closed();
      open.value = false;
    }
    return () => [
      h(
        'button',
        {
          onClick: () => {
            open.value = true;
          }
        },
        'Open'
      ),
      h(Dialog, { open: open.value, title: 'Form', onClose: close }, () => h('input', { 'aria-label': 'Draft' }))
    ];
  });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Open' }));
  await user.type(await screen.findByRole('textbox', { name: 'Draft' }), 'saved nowhere');
  await user.click(screen.getByRole('button', { name: 'Закрыть' }));
  expect(closed).toHaveBeenCalledTimes(1);
  const opener = await screen.findByRole('button', { name: 'Open' });
  await user.click(opener);
  expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveProperty('value', '');
});

function datePopup() {
  return h(
    Popover,
    { ariaLabel: 'Dates', role: 'dialog' },
    {
      trigger: ({ open, toggle, panelId }: PopoverTriggerState) =>
        h('button', { 'aria-expanded': open, 'aria-controls': panelId, onClick: toggle }, 'Dates'),
      content: ({ close }: PopoverContentState) => [
        h('input', { 'aria-label': 'Date', type: 'date' }),
        h('button', { onClick: () => close() }, 'Apply')
      ]
    }
  );
}

function renderPopup() {
  return renderFixture(() => () => [datePopup(), h('button', 'Outside')]);
}

for (const action of ['Escape', 'Apply'] as const) {
  test('popover restores trigger on ' + action, async () => {
    renderPopup();
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: 'Dates' });
    await user.click(trigger);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText('Date'));
    if (action === 'Escape') await user.keyboard('{Escape}');
    else await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
}

test('outside dismissal retains the clicked destination focus', async () => {
  renderPopup();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Dates' }));
  await user.tab();
  const outside = screen.getByRole('button', { name: 'Outside' });
  await user.click(outside);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(outside);
});

test('independent radio groups support arrows without changing the other group', async () => {
  const options = [
    { value: 'one', label: 'One' },
    { value: 'two', label: 'Two' }
  ];
  function choices(label: string) {
    const current = ref('one');
    return () =>
      h(SegmentControl, {
        ariaLabel: label,
        options,
        value: current.value,
        onChange: (next: string) => {
          current.value = next;
        }
      });
  }
  renderFixture(() => {
    const first = choices('First');
    const second = choices('Second');
    return () => [first(), second()];
  });
  const user = userEvent.setup();
  const first = within(screen.getByRole('radiogroup', { name: 'First' }));
  const second = within(screen.getByRole('radiogroup', { name: 'Second' }));
  await user.tab();
  await user.keyboard('{ArrowRight}');
  expect(first.getByRole('radio', { name: 'Two', checked: true })).toBe(document.activeElement);
  await user.keyboard('{ArrowRight}');
  expect(first.getByRole('radio', { name: 'One', checked: true })).toBe(document.activeElement);
  await user.keyboard('{ArrowLeft}');
  expect(first.getByRole('radio', { name: 'Two', checked: true })).toBe(document.activeElement);
  expect(second.getByRole('radio', { name: 'One', checked: true })).toBeTruthy();
});

test('programmatic close, reopen and stale close events do not emit a close request', async () => {
  const onClose = vi.fn();
  const view = renderWithApp(Dialog, {
    props: { open: true, title: 'Lifecycle', onClose },
    slots: { default: () => h('input', { 'aria-label': 'Value' }) }
  });
  expect(onClose).not.toHaveBeenCalled();
  await fireEvent(await screen.findByRole('dialog'), new Event('close'));
  expect(onClose).not.toHaveBeenCalled();
  await view.rerender({ open: false });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
  await view.rerender({ open: true });
  expect(await screen.findByRole('dialog')).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();
});

// Safari does not focus buttons on pointer activation.
test('popover restores the actual trigger when opening did not focus it', async () => {
  renderPopup();
  const outside = screen.getByRole('button', { name: 'Outside' });
  outside.focus();
  const trigger = screen.getByRole('button', { name: 'Dates' });
  await fireEvent.click(trigger);
  expect(document.activeElement).toBe(outside);
  screen.getByLabelText('Date').focus();
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

test('nested popover consumes Escape before its parent modal', async () => {
  const onClose = vi.fn();
  const onKeydown = vi.fn();
  renderFixture(
    () => () => h(Dialog, { open: true, title: 'Parent', onClose }, () => h('div', { onKeydown }, [datePopup()]))
  );
  await userEvent.click(await screen.findByRole('button', { name: 'Dates' }));
  const field = screen.getByLabelText('Date');
  field.focus();
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  await fireEvent(field, escape);
  expect(escape.defaultPrevented).toBe(true);
  expect(onKeydown).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Dates' })).toBeNull());
  expect(screen.getByRole('dialog', { name: 'Parent' })).toBeTruthy();
});

test('popover can dismiss after its opening control is removed', async () => {
  renderFixture(() => {
    const visible = ref(true);
    return () =>
      h(
        Popover,
        { ariaLabel: 'Temporary', role: 'dialog' },
        {
          trigger: ({ toggle }: PopoverTriggerState) =>
            visible.value ? h('button', { onClick: toggle }, 'Open temporary') : null,
          content: ({ close }: PopoverContentState) => [
            h('input', {
              'aria-label': 'Content',
              onFocus: () => {
                visible.value = false;
              }
            }),
            h('button', { onClick: () => close() }, 'Done')
          ]
        }
      );
  });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Open temporary' }));
  await user.tab();
  expect(screen.queryByRole('button', { name: 'Open temporary' })).toBeNull();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
});
