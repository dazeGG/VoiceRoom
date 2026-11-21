import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import Field from '../Field/Field.vue';
import NumberField from './NumberField.vue';
import type { NumberFieldProps } from './types';

type Args = NumberFieldProps & { modelValue?: number | null; error?: string };

const meta = {
  title: 'Components/Inputs/NumberField',
  component: NumberField,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'Reka NumberField with step buttons inside the field.',
          '',
          '- Use sizes sm 32 and md 40.',
          '- Make the «−» and «+» buttons an IconButton 28 inside the field, and centre the value in tabular figures.',
          '- Let min and max each disable its own button.',
          '- Put the unit in the label («Ширина, px» (Width, px)).'
        ].join('\n')
      }
    }
  },
  args: { min: 0, max: 48, step: 4, modelValue: 16 },
  render: (args: Args) => ({
    components: { Field, NumberField },
    setup: () => ({ args, value: ref(args.modelValue) }),
    template: `<Field label="Отступ, px" :error="args.error">
      <NumberField v-model="value" :size="args.size" :min="args.min" :max="args.max" :step="args.step"
        :disabled="args.disabled" :readonly="args.readonly" :allow-invalid="args.allowInvalid" />
    </Field>`
  })
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Medium: Story = {};
export const Small: Story = { args: { size: 'sm' } };
export const Empty: Story = { args: { modelValue: null } };
export const Minimum: Story = { args: { modelValue: 0 } };
export const Maximum: Story = { args: { modelValue: 48 } };
export const Disabled: Story = { args: { disabled: true } };
export const ReadOnly: Story = { args: { readonly: true } };
export const Invalid: Story = { args: { modelValue: 52, allowInvalid: true, error: 'Укажите отступ от 0 до 48 px' } };
