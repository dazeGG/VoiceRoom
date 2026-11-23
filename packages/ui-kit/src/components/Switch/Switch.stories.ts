import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import Switch from './Switch.vue';
import type { SwitchProps } from './types';

const meta = {
  title: 'Components/Inputs/Switch',
  component: Switch,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'Reka Switch for a setting that applies immediately.',
          '',
          '- Use sm 32×20 and md 40×24.',
          '- Put the label on the left of a settings row and the switch on the right.',
          '- Make `aria-label` match the label.',
          '- Use `sm` in popovers and dense panels, and `md` in settings.'
        ].join('\n')
      }
    }
  },
  args: { ariaLabel: 'Шумовой гейт', modelValue: true, size: 'md' },
  render: (args: SwitchProps & { modelValue: boolean }) => ({
    components: { Switch },
    setup: () => ({ args, checked: ref(args.modelValue) }),
    template: '<label>{{ args.ariaLabel }} <Switch v-bind="args" v-model="checked" /></label>'
  })
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Medium: Story = {};
export const Small: Story = { args: { size: 'sm', modelValue: false } };
export const Disabled: Story = { args: { disabled: true, modelValue: false } };
