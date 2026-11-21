import { render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { Splitter, type SplitterWidth } from '@voice-room/ui/components';
import { stubOverlayDom } from '../helpers/overlay-dom';
import { stubSplitterLayout } from '../helpers/splitter-layout';

stubOverlayDom();

const Panels = defineComponent({
  components: { Splitter },
  props: { collapsible: Boolean },
  emits: { commit: (_layout: SplitterWidth) => true },
  setup: ({ collapsible }) => ({
    collapsed: ref(false),
    bounds: collapsible
      ? { width: 280, minWidth: 240, maxWidth: 420, collapsedWidth: 48 }
      : { width: 248, minWidth: 200, maxWidth: 340 }
  }),
  template: `
    <Splitter v-model:collapsed="collapsed" v-bind="bounds" label="Ширина панели" @commit="$emit('commit', $event)">
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

  const handle = screen.getByRole('separator', { name: 'Ширина панели' });
  expect(handle.getAttribute('aria-orientation')).toBe('vertical');
  expect(handle.getAttribute('aria-valuetext')).toBe('248 px');
  await user.tab();
  expect(document.activeElement).toBe(handle);
  await user.keyboard('{ArrowRight}');
  expect(handle.getAttribute('aria-valuetext')).toBe('264 px');
  expect(onCommit).toHaveBeenLastCalledWith({ width: 264, collapsed: false });
  await user.keyboard('{ArrowLeft}');
  expect(handle.getAttribute('aria-valuetext')).toBe('248 px');
  await user.keyboard('{Home}');
  expect(handle.getAttribute('aria-valuetext')).toBe('200 px');
  await user.keyboard('{End}{ArrowRight}');
  expect(handle.getAttribute('aria-valuetext')).toBe('340 px');
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
