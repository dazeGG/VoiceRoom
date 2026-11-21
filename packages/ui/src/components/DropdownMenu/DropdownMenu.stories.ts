import type { Meta, StoryObj } from '@storybook/vue3-vite';
import StoryIcon from '../../../.storybook/StoryIcon.vue';
import { ref } from 'vue';
import IconButton from '../IconButton/IconButton.vue';
import { MenuCheckboxItem } from '../MenuCheckboxItem';
import { MenuItem } from '../MenuItem';
import { MenuLabel } from '../MenuLabel';
import { MenuRadioGroup } from '../MenuRadioGroup';
import { MenuRadioItem } from '../MenuRadioItem';
import { MenuSeparator } from '../MenuSeparator';
import { MenuSub } from '../MenuSub';
import DropdownMenu from './DropdownMenu.vue';

const meta = {
  title: 'Components/Overlays/DropdownMenu',
  component: DropdownMenu,
  tags: ['autodocs'],
  args: { side: 'bottom', align: 'start', ariaLabel: 'Действия с комнатой' },
  render: (args) => ({
    components: {
      StoryIcon,
      DropdownMenu,
      IconButton,
      MenuCheckboxItem,
      MenuItem,
      MenuLabel,
      MenuRadioGroup,
      MenuRadioItem,
      MenuSeparator,
      MenuSub
    },
    setup: () => ({ args, muted: ref(false), notifications: ref('all') }),
    template: `
      <DropdownMenu v-bind="args">
        <template #trigger><IconButton label="Действия с комнатой"><StoryIcon name="ellipsis" /></IconButton></template>
        <template #content>
          <MenuLabel text="Комната" />
          <MenuItem label="Скопировать ссылку" shortcut="Ctrl+C">
            <template #icon><StoryIcon name="copy" /></template>
          </MenuItem>
          <MenuItem label="Позвать друга" tone="friendly">
            <template #icon><StoryIcon name="user-plus" /></template>
          </MenuItem>
          <MenuItem label="Выйти из комнаты" disabled>
            <template #icon><StoryIcon name="arrow-right" /></template>
          </MenuItem>
          <MenuSeparator />
          <MenuCheckboxItem v-model="muted" label="Отключить звук" @select.prevent>
            <template #icon><StoryIcon name="bell" /></template>
          </MenuCheckboxItem>
          <MenuSub label="Уведомления">
            <MenuRadioGroup v-model="notifications" aria-label="Режим уведомлений">
              <MenuRadioItem value="all" label="Все сообщения" />
              <MenuRadioItem value="mentions" label="Только упоминания" description="Уведомлять, когда вас упомянули" />
            </MenuRadioGroup>
          </MenuSub>
          <MenuSeparator />
          <MenuItem label="Удалить комнату" tone="danger" shortcut="Del">
            <template #icon><StoryIcon name="trash-2" /></template>
          </MenuItem>
        </template>
      </DropdownMenu>
    `
  })
} satisfies Meta<typeof DropdownMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const TopEnd: Story = {
  args: { side: 'top', align: 'end' },
  parameters: { layout: 'centered' }
};
