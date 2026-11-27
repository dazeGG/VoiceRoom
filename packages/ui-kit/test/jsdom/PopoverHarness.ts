// Test components: a popover with a button trigger, three menu items and an optional submenu.

import { defineComponent, h, ref } from 'vue';
import { Popover } from '@voiceroom/ui-kit/components';
import type { PopoverCloseReason, PopoverRole } from '@voiceroom/ui-kit/components';

export type PopoverHarnessProps = {
  label?: string;
  role?: PopoverRole;
  keepContentMounted?: boolean;
  floating?: boolean;
  width?: 'standard' | 'wide';
  onBeforeClose?: (reason: PopoverCloseReason) => boolean | void;
};

/** A component rendering the popover with the given options. */
export function popoverHarness(props: PopoverHarnessProps = {}) {
  return defineComponent(() => {
    const open = ref(false);
    return () => {
      const label = props.label ?? 'open';
      return h(
        Popover,
        {
          open: open.value,
          'onUpdate:open': (value: boolean) => (open.value = value),
          ariaLabel: `Меню ${label}`,
          role: props.role ?? 'menu',
          keepContentMounted: props.keepContentMounted ?? false,
          floating: props.floating ?? false,
          ...(props.width ? { width: props.width } : {}),
          ...(props.onBeforeClose ? { onBeforeClose: props.onBeforeClose } : {})
        },
        {
          trigger: ({ toggle, panelId }: { toggle: () => void; panelId: string }) =>
            h('button', { type: 'button', 'aria-controls': panelId, onClick: toggle }, label),
          content: () =>
            ['A', 'B', 'C'].map((letter) =>
              h(
                'button',
                {
                  type: 'button',
                  role: props.role === 'dialog' ? undefined : 'menuitem'
                },
                `${label} ${letter}`
              )
            )
        }
      );
    };
  });
}
