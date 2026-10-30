// Test components: a popover with a button trigger, three menu items and an optional submenu.

import { defineComponent, h, ref } from 'vue';
import { Popover, PopoverMenuItem, PopoverSubmenu } from '@/shared/ui/Popover';
import type { PopoverCloseReason, PopoverRole } from '@/shared/ui/Popover';

export type PopoverHarnessProps = {
  label?: string;
  role?: PopoverRole;
  keepContentMounted?: boolean;
  floating?: boolean;
  withSubmenu?: boolean;
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
          ...(props.onBeforeClose ? { onBeforeClose: props.onBeforeClose } : {})
        },
        {
          trigger: ({ toggle, panelId }: { toggle: () => void; panelId: string }) =>
            h('button', { type: 'button', 'aria-controls': panelId, onClick: toggle }, label),
          content: () => [
            h(PopoverMenuItem, { label: `${label} A` }),
            h(PopoverMenuItem, { label: `${label} B` }),
            h(PopoverMenuItem, { label: `${label} C` }),
            ...(props.withSubmenu
              ? [h(PopoverSubmenu, { label: 'Ещё' }, { default: () => [h(PopoverMenuItem, { label: 'Вложенный' })] })]
              : [])
          ]
        }
      );
    };
  });
}
