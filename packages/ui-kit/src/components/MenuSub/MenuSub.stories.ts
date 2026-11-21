import type { Meta, StoryObj } from '@storybook/vue3-vite';
import Button from '../Button/Button.vue';
import DropdownMenu from '../DropdownMenu/DropdownMenu.vue';
import MenuItem from '../MenuItem/MenuItem.vue';
import MenuSub from './MenuSub.vue';

const meta = {
  title: 'Components/Overlays/MenuSub',
  component: MenuSub,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'A menu row that opens a nested panel of actions or choices.',
          '',
          '- Give the trigger a `label` and provide the submenu rows in the default slot.',
          '- Set `aria-label` when the nested panel needs a separate name and use the slot’s `close` callback for custom content.',
          '- Escape closes the submenu and returns focus to the trigger after any open combobox has dismissed.'
        ].join('\n')
      }
    }
  },
  args: { label: 'Пригласить друга' },
  render: (args) => ({
    components: { MenuSub, Button, DropdownMenu, MenuItem },
    setup: () => ({ args }),
    template: `<DropdownMenu aria-label="Действия с комнатой">
        <template #trigger><Button>Действия</Button></template>
        <template #content><MenuSub v-bind="args"><MenuItem label="Анна" /><MenuItem label="Мира" /></MenuSub></template>
      </DropdownMenu>`
  })
} satisfies Meta<typeof MenuSub>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true } };
