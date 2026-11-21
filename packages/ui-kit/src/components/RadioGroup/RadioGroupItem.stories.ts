import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import RadioGroup from './RadioGroup.vue';
import RadioGroupItem from './RadioGroupItem.vue';

const meta = {
  title: 'Components/Inputs/RadioGroupItem',
  component: RadioGroupItem,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'A single custom-rendered option belonging to a RadioGroup.',
          '',
          '- Pass an `option` with a unique value, label and optional description.',
          '- Match the group’s `variant`. Use the default slot for a custom label or tile content and `preview` for a card preview.'
        ].join('\n')
      }
    }
  },
  args: { option: { value: 'volt', label: 'Вольт' }, variant: 'card' },
  render: (args) => ({
    components: { RadioGroupItem, RadioGroup },
    setup: () => ({ args, selected: ref('volt') }),
    template: `
      <RadioGroup v-model="selected" :variant="args.variant" aria-label="Тема">
        <template #item>
          <RadioGroupItem v-bind="args">{{ args.option.label }}</RadioGroupItem>
          <RadioGroupItem :option="{ value: 'ice', label: 'Лёд' }" :variant="args.variant">Лёд</RadioGroupItem>
        </template>
      </RadioGroup>
    `
  })
} satisfies Meta<typeof RadioGroupItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const List: Story = { args: { variant: 'list' } };
export const Tile: Story = { args: { variant: 'tile' } };
