import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import TextField from '../TextField/TextField.vue';
import Field from './Field.vue';
import type { FieldProps } from './types';

const meta = {
  title: 'Components/Inputs/Field',
  component: Field,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'The label, hint and error wrapper for a single form control.',
          '',
          '- Provide a label and mark an optional control with `optional`.',
          '- Kit controls inherit the control ID and accessibility attributes. A custom kit control can bind the default slot’s `control` attributes.',
          '- Show an error as soon as the field becomes invalid. It replaces the hint and supplies the field’s accessible description.',
          '- Use `visuallyHiddenLabel` or `visuallyHiddenHint` to keep the text available to assistive technology.'
        ].join('\n')
      }
    }
  },
  args: { label: 'Имя' },
  render: (args: FieldProps) => ({
    components: { Field, TextField },
    setup: () => ({ args, value: ref('') }),
    template: '<Field v-bind="args"><TextField v-model="value" placeholder="Мира" /></Field>'
  })
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Hint: Story = { args: { hint: 'Как вас будут видеть в комнате' } };
export const Optional: Story = { args: { label: 'Город', optional: true } };
export const Error: Story = { args: { error: 'Укажите имя', hint: 'Как вас будут видеть в комнате' } };

export const HiddenLabel: Story = { args: { visuallyHiddenLabel: true, visuallyHiddenHint: true } };
