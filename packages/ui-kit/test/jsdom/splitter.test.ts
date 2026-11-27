import { fireEvent, render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { Splitter, type SplitterSize } from '@voiceroom/ui-kit/components';
import { stubOverlayDom } from '../../../../apps/web/test/helpers/overlay-dom';
import { stubSplitterLayout } from '../../../../apps/web/test/helpers/splitter-layout';

stubOverlayDom();

const Panels = defineComponent({
  components: { Splitter },
  props: { collapsible: Boolean, vertical: Boolean },
  emits: { commit: (_layout: SplitterSize) => true },
  setup: ({ collapsible }) => ({
    collapsed: ref(false),
    bounds: collapsible
      ? { size: 280, minSize: 240, maxSize: 420, collapsedSize: 48 }
      : { size: 248, minSize: 200, maxSize: 340 }
  }),
  template: `
    <Splitter
      v-model:collapsed="collapsed"
      v-bind="bounds"
      :direction="vertical ? 'vertical' : 'horizontal'"
      label="Размер панели"
      @commit="$emit('commit', $event)"
    >
      <template #side>
        <button v-if="collapsible" type="button" @click="collapsed = !collapsed">Развернуть панель</button>
        <span v-else>Друзья</span>
      </template>
      Сообщения
    </Splitter>`
});

test('a splitter resizes by sixteen pixels and jumps to both bounds', async () => {
  stubSplitterLayout();
  const user = userEvent.setup();
  const onCommit = vi.fn();
  render(Panels, { props: { onCommit } });

  const handle = screen.getByRole('separator', { name: 'Размер панели' });
  expect(handle.getAttribute('aria-orientation')).toBe('vertical');
  expect(handle.getAttribute('aria-valuetext')).toBe('248 px');
  await user.tab();
  expect(document.activeElement).toBe(handle);
  await user.keyboard('{ArrowRight}');
  expect(handle.getAttribute('aria-valuetext')).toBe('264 px');
  expect(onCommit).toHaveBeenLastCalledWith({ size: 264, collapsed: false });
  await user.keyboard('{ArrowLeft}');
  expect(handle.getAttribute('aria-valuetext')).toBe('248 px');
  await user.keyboard('{Home}');
  expect(handle.getAttribute('aria-valuetext')).toBe('200 px');
  await user.keyboard('{End}{ArrowRight}');
  expect(handle.getAttribute('aria-valuetext')).toBe('340 px');
});

test('a vertical splitter uses up and down and clamps to the pane heights', async () => {
  stubSplitterLayout();
  const user = userEvent.setup();
  const onCommit = vi.fn();
  render(Panels, { props: { onCommit, vertical: true } });

  const handle = screen.getByRole('separator');
  expect(handle.getAttribute('aria-orientation')).toBe('horizontal');
  handle.focus();
  await user.keyboard('{ArrowDown}');
  expect(handle.getAttribute('aria-valuetext')).toBe('264 px');
  await user.keyboard('{ArrowUp}{ArrowLeft}');
  expect(onCommit).toHaveBeenLastCalledWith({ size: 248, collapsed: false });
  await user.keyboard('{Home}{ArrowUp}');
  expect(handle.getAttribute('aria-valuetext')).toBe('200 px');
  await user.keyboard('{End}{ArrowDown}');
  expect(handle.getAttribute('aria-valuetext')).toBe('340 px');
});

test('dragging a vertical splitter continues after the pointer leaves the handle', async () => {
  stubSplitterLayout();
  const onCommit = vi.fn();
  render(Panels, { props: { onCommit, vertical: true } });
  const handle = screen.getByRole('separator');
  await nextTick();

  await fireEvent.mouseDown(handle, { clientX: 400, clientY: 248 });
  await fireEvent.mouseMove(document.body, { clientX: 400, clientY: 296 });
  await fireEvent.mouseMove(document.body, { clientX: 400, clientY: 312 });
  await fireEvent.mouseUp(window, { clientX: 400, clientY: 312 });

  expect(handle.getAttribute('aria-valuetext')).toBe('312 px');
  expect(onCommit).toHaveBeenLastCalledWith({ size: 312, collapsed: false });
});

test('a splitter can collapse to a rail and reopen at its previous preferred width', async () => {
  stubSplitterLayout();
  const user = userEvent.setup();
  render(Panels, { props: { collapsible: true } });
  screen.getByRole('separator').focus();
  await user.keyboard('{Home}');
  expect(screen.queryByRole('separator')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Развернуть панель' }));
  expect(screen.getByRole('separator').getAttribute('aria-valuetext')).toBe('280 px');
});
