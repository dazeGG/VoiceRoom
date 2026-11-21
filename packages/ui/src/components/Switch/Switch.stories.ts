import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import Switch from './Switch.vue';
import type { SwitchProps } from './types';

const meta = {
  title: 'Components/Inputs/Switch',
  component: Switch,
  tags: ['autodocs'],
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
