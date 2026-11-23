import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import Button from '../Button/Button.vue';
import DropdownMenu from '../DropdownMenu/DropdownMenu.vue';
import MenuCheckboxItem from './MenuCheckboxItem.vue';
import type { MenuCheckboxItemProps } from './types';

type Args = MenuCheckboxItemProps & { modelValue?: boolean | 'indeterminate' };

const meta = {
  title: 'Components/Overlays/MenuCheckboxItem',
  component: MenuCheckboxItem,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'A menu row that toggles an independent option.',
          '',
          '- Bind `v-model` to a boolean or `indeterminate` for a partially applied choice.',
          '- Use the `select` event to handle activation. Prevent its default when the menu should stay open.',
          '- Use the same label, description, icon and shortcut conventions as MenuItem.'
        ].join('\n')
      }
    }
  },
  args: { label: 'Отключить звук' },
  render: (args: Args) => ({
    components: { MenuCheckboxItem, Button, DropdownMenu },
    setup: () => ({ args, checked: ref(args.modelValue) }),
    template: `<DropdownMenu aria-label="Действия с комнатой">
        <template #trigger><Button>Действия</Button></template>
        <template #content><MenuCheckboxItem v-bind="args" v-model="checked" @select.prevent /></template>
      </DropdownMenu>`
  })
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Partial: Story = { args: { modelValue: 'indeterminate' } };
