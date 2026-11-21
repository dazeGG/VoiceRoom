import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import Checkbox from './Checkbox.vue';
import type { CheckboxProps, CheckboxValue } from './types';

type Args = CheckboxProps & { modelValue?: CheckboxValue; label: string };

const meta = {
  title: 'Components/Inputs/Checkbox',
  component: Checkbox,
  tags: ['autodocs'],
  args: { label: 'Я сохранил коды восстановления', size: 'md' },
  render: (args: Args) => ({
    components: { Checkbox },
    setup: () => ({ args, checked: ref(args.modelValue) }),
    template:
      '<Checkbox v-model="checked" :size="args.size" :description="args.description" :disabled="args.disabled">{{ args.label }}</Checkbox>'
  })
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unchecked: Story = {};
export const Checked: Story = {
  args: { modelValue: true, description: 'Без них не получится войти, если вы забудете пароль' }
};
export const Small: Story = { args: { size: 'sm', label: 'Больше не спрашивать' } };
export const Indeterminate: Story = {
  args: { label: 'Все уведомления', description: 'Часть каналов выключена', modelValue: 'indeterminate' }
};
export const Disabled: Story = { args: { disabled: true } };
export const DisabledChecked: Story = { args: { disabled: true, modelValue: true } };
