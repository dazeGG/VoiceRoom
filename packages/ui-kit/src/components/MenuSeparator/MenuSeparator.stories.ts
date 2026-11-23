import type { Meta, StoryObj } from '@storybook/vue3-vite';
import Button from '../Button/Button.vue';
import DropdownMenu from '../DropdownMenu/DropdownMenu.vue';
import MenuItem from '../MenuItem/MenuItem.vue';
import MenuSeparator from './MenuSeparator.vue';

const meta = {
  title: 'Components/Overlays/MenuSeparator',
  component: MenuSeparator,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'A visual divider between related groups of menu items.',
          '',
          '- Place it between distinct groups in a dropdown or context menu, such as before a final destructive action.'
        ].join('\n')
      }
    }
  },
  render: () => ({
    components: { MenuSeparator, Button, DropdownMenu, MenuItem },
    template: `<DropdownMenu aria-label="Действия с комнатой">
        <template #trigger><Button>Действия</Button></template>
        <template #content>
          <MenuItem label="Скопировать ссылку" />
          <MenuSeparator />
          <MenuItem label="Удалить комнату" tone="danger" />
        </template>
      </DropdownMenu>`
  })
} satisfies Meta<typeof MenuSeparator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
