import type { Meta, StoryObj } from '@storybook/vue3-vite';
import StoryIcon from '../../../.storybook/StoryIcon.vue';
import { ref, shallowRef } from 'vue';
import Button from '../Button/Button.vue';
import { MenuItem } from '../MenuItem';
import { MenuSeparator } from '../MenuSeparator';
import ContextMenu from './ContextMenu.vue';
import ContextMenuHeaderButton from './ContextMenuHeaderButton.vue';
import type { ContextMenuProps } from './types';

const meta = {
  title: 'Components/Overlays/ContextMenu',
  component: ContextMenu,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'Reka ContextMenu drawn like DropdownMenu, with the same actions available from a More button.',
          '',
          '- Draw it the same way as DropdownMenu.',
          '- Put a row of quick reactions on top: a Toolbar of IconButton 32.',
          '- Make everything in the context menu available through the «Ещё» (More) button in the hover toolbar as well.'
        ].join('\n')
      }
    }
  },
  args: { open: false, x: 0, y: 0, ariaLabel: 'Действия с сообщением', headerLabel: 'Быстрые реакции' },
  render: (args: ContextMenuProps) => ({
    components: {
      StoryIcon,
      Button,
      ContextMenu,
      ContextMenuHeaderButton,
      MenuItem,
      MenuSeparator
    },
    setup() {
      const point = ref({ x: args.x, y: args.y });
      const open = ref(args.open);
      const trigger = shallowRef<HTMLElement | null>(null);
      function show(event: MouseEvent): void {
        if (!(event.currentTarget instanceof HTMLElement)) return;
        trigger.value = event.currentTarget;
        const rect = event.currentTarget.getBoundingClientRect();
        point.value = { x: event.clientX || rect.left, y: event.clientY || rect.bottom };
        open.value = true;
      }
      return { args, open, point, trigger, show };
    },
    template: `
      <Button aria-haspopup="menu" :aria-expanded="open" @click="show" @contextmenu.prevent="show">Открыть действия</Button>
      <ContextMenu v-bind="{ ...args, ...point }" :open="open" :restore-focus="trigger" @close="open = false">
        <template #header="{ close }">
          <ContextMenuHeaderButton label="Нравится" @click="close()"><StoryIcon name="thumbs-up" /></ContextMenuHeaderButton>
          <ContextMenuHeaderButton label="Поддержать" :pressed="true" @click="close()"><StoryIcon name="heart" /></ContextMenuHeaderButton>
          <ContextMenuHeaderButton label="Поставить реакцию" @click="close()"><StoryIcon name="smile-plus" /></ContextMenuHeaderButton>
        </template>
        <MenuItem label="Ответить"><template #icon><StoryIcon name="reply" /></template></MenuItem>
        <MenuItem label="Скопировать текст" shortcut="Ctrl+C"><template #icon><StoryIcon name="copy" /></template></MenuItem>
        <MenuSeparator />
        <MenuItem label="Удалить" tone="danger" shortcut="Del"><template #icon><StoryIcon name="trash-2" /></template></MenuItem>
      </ContextMenu>
    `
  })
} satisfies Meta<typeof ContextMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithReactions: Story = {};
