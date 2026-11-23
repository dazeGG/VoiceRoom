import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import Checkbox from './Checkbox.vue';
import type { CheckboxProps, CheckboxValue } from './types';

type Args = CheckboxProps & { modelValue?: CheckboxValue; label: string };

const meta = {
  title: 'Components/Inputs/Checkbox',
  component: Checkbox,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'Reka Checkbox for a choice that a button later confirms.',
          '',
          '- Use sizes sm 16 and md 20, with a row from 24.',
          '- Include the partial state («частично»).',
          '- Put the checkbox on the left, make the whole row clickable, and put the description in a caption.',
          '- Use a `--vr-text-3` frame. When checked, fill with `--vr-accent` and draw the check in `--vr-accent-ink`.',
          '- Use it for something a button confirms. Use Switch for something that applies immediately.'
        ].join('\n')
      }
    }
  },
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
