import { render, screen, waitFor } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { defineComponent } from 'vue';
import { Separator, Toolbar, ToolbarButton, ToolbarToggle } from '@voice-room/ui/components';
import { stubOverlayDom } from '../helpers/overlay-dom';

stubOverlayDom();

test('the toolbar has one tab stop and arrow movement skips disabled buttons', async () => {
  const user = userEvent.setup();
  const copy = vi.fn();
  render(
    defineComponent({
      components: { Separator, Toolbar, ToolbarButton, ToolbarToggle },
      setup: () => ({ copy }),
      template: `
      <Toolbar label="Редактор">
        <ToolbarToggle label="Жирный" :shortcut="['Ctrl', 'B']" />
        <Separator orientation="vertical" />
        <ToolbarButton label="Отменить" disabled />
        <ToolbarButton label="Копировать" @click="copy" />
      </Toolbar>
      <button type="button">Дальше</button>`
    })
  );
  const bold = screen.getByRole('button', { name: 'Жирный' });
  const copyButton = screen.getByRole('button', { name: 'Копировать' });
  await user.tab();
  await waitFor(() => expect(document.activeElement).toBe(bold));
  await user.keyboard(' ');
  expect(bold.getAttribute('aria-pressed')).toBe('true');

  await user.keyboard('{ArrowRight}');
  await waitFor(() => expect(document.activeElement).toBe(copyButton));
  await user.keyboard('{Enter}');
  expect(copy).toHaveBeenCalledOnce();
  await user.keyboard('{Home}');
  await waitFor(() => expect(document.activeElement).toBe(bold));
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Дальше' }));
});
