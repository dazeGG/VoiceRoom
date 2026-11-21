import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import Field from '../Field/Field.vue';
import Select from './Select.vue';

const meta = {
  title: 'Components/Inputs/Select',
  component: Select,
  tags: ['autodocs'],
  args: {
    label: 'Микрофон',
    options: [
      { value: '', label: 'По умолчанию' },
      { value: 'headset', label: 'Микрофон гарнитуры' },
      { value: 'studio', label: 'Студийный микрофон' }
    ],
    size: 'md',
    placement: 'bottom-start',
    flip: true
  },
  render: (args) => ({
    components: { Select },
    setup() {
      const value = ref('');
      return { args, value };
    },
    template: '<Select v-bind="args" v-model="value" />'
  })
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Medium: Story = {};
export const Small: Story = { args: { size: 'sm' } };
export const Large: Story = { args: { size: 'lg' } };
export const Ghost: Story = {
  args: {
    label: 'Язык',
    variant: 'ghost',
    size: 'sm',
    options: [
      { value: '', label: 'Русский' },
      { value: 'en', label: 'Английский' },
      { value: 'fr', label: 'Французский' }
    ]
  }
};
export const InvalidField: Story = {
  render: (args) => ({
    components: { Field, Select },
    setup: () => ({ args }),
    template: '<Field label="Микрофон" error="Выберите доступный микрофон"><Select v-bind="args" /></Field>'
  }),
  args: { label: '' }
};
export const Open: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('combobox'));
  }
};
export const Disabled: Story = { args: { disabled: true } };
export const Empty: Story = { args: { options: [] } };
export const BottomEnd: Story = { args: { placement: 'bottom-end' } };
export const TopStart: Story = { args: { placement: 'top-start' } };
export const TopEnd: Story = { args: { placement: 'top-end' } };

export const CustomLabel: Story = {
  render: (args) => ({
    components: { Select },
    setup: () => ({ args }),
    template: '<Select v-bind="args"><template #option-label="{ text }"><strong>{{ text }}</strong></template></Select>'
  })
};
