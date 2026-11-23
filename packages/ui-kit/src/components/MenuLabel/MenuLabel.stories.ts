import type { Meta, StoryObj } from '@storybook/vue3-vite';
import Button from '../Button/Button.vue';
import DropdownMenu from '../DropdownMenu/DropdownMenu.vue';
import MenuItem from '../MenuItem/MenuItem.vue';
import MenuLabel from './MenuLabel.vue';

const meta = {
  title: 'Components/Overlays/MenuLabel',
  component: MenuLabel,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'A non-interactive heading for a group of menu rows.',
          '',
          '- Pass a short `text` label that describes the rows immediately below it.',
          '- Use the label inside a dropdown or context menu. Use MenuItem for a selectable row.'
        ].join('\n')
      }
    }
  },
  args: { text: 'Комната' },
  render: (args) => ({
    components: { MenuLabel, Button, DropdownMenu, MenuItem },
    setup: () => ({ args }),
    template: `<DropdownMenu aria-label="Действия с комнатой">
        <template #trigger><Button>Действия</Button></template>
        <template #content><MenuLabel v-bind="args" /><MenuItem label="Скопировать ссылку" /></template>
      </DropdownMenu>`
  })
} satisfies Meta<typeof MenuLabel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
