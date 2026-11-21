import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import Button from '../Button/Button.vue';
import DropdownMenu from '../DropdownMenu/DropdownMenu.vue';
import MenuRadioItem from '../MenuRadioItem/MenuRadioItem.vue';
import MenuRadioGroup from './MenuRadioGroup.vue';

const meta = {
  title: 'Components/Overlays/MenuRadioGroup',
  component: MenuRadioGroup,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'A mutually exclusive set of choices inside a dropdown or context menu.',
          '',
          '- Place MenuRadioItem children here and bind `v-model` to the selected string value.',
          '- Give the group a meaningful `aria-label` when it needs a distinct name.'
        ].join('\n')
      }
    }
  },
  args: { ariaLabel: 'Режим уведомлений' },
  render: (args) => ({
    components: { MenuRadioGroup, Button, DropdownMenu, MenuRadioItem },
    setup: () => ({ args, selected: ref('all') }),
    template: `<DropdownMenu aria-label="Действия с комнатой">
        <template #trigger><Button>Действия</Button></template>
        <template #content><MenuRadioGroup v-bind="args" v-model="selected"><MenuRadioItem value="all" label="Все сообщения" /><MenuRadioItem value="mentions" label="Только упоминания" /></MenuRadioGroup></template>
      </DropdownMenu>`
  })
} satisfies Meta<typeof MenuRadioGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
