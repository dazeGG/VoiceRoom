import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import Button from '../Button/Button.vue';
import DropdownMenu from '../DropdownMenu/DropdownMenu.vue';
import MenuRadioGroup from '../MenuRadioGroup/MenuRadioGroup.vue';
import MenuRadioItem from './MenuRadioItem.vue';

const meta = {
  title: 'Components/Overlays/MenuRadioItem',
  component: MenuRadioItem,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'One choice inside a MenuRadioGroup.',
          '',
          '- Set a unique `value` within the group and a `label` for the accessible name and typeahead.',
          '- Use `description` for a second line and `disabled` to make an option unavailable.',
          '- Bind the selected value on the group. The row shows its checked indicator when selected.'
        ].join('\n')
      }
    }
  },
  args: { value: 'all', label: 'Все сообщения' },
  render: (args) => ({
    components: { MenuRadioItem, Button, DropdownMenu, MenuRadioGroup },
    setup: () => ({ args, selected: ref('all') }),
    template: `<DropdownMenu aria-label="Действия с комнатой">
        <template #trigger><Button>Действия</Button></template>
        <template #content><MenuRadioGroup v-model="selected" aria-label="Режим уведомлений"><MenuRadioItem v-bind="args" /><MenuRadioItem value="mentions" label="Только упоминания" /></MenuRadioGroup></template>
      </DropdownMenu>`
  })
} satisfies Meta<typeof MenuRadioItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true } };
