import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import TextField from '../TextField/TextField.vue';
import Field from './Field.vue';
import type { FieldProps } from './types';

const meta = {
  title: 'Components/Inputs/Field',
  component: Field,
  tags: ['autodocs'],
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
