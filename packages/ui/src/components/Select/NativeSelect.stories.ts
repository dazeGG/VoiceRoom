import type { Meta, StoryObj } from '@storybook/vue3-vite';
import NativeSelect from './NativeSelect.vue';

const meta = {
  title: 'Components/Inputs/NativeSelect',
  component: NativeSelect,
  tags: ['autodocs'],
  args: {
    label: 'Устройство вывода',
    options: [
      { value: '', label: 'По умолчанию' },
      { value: 'speakers', label: 'Колонки' }
    ]
  },
  render: (args) => ({
    components: { NativeSelect },
    setup: () => ({ args }),
    template: '<NativeSelect v-bind="args" />'
  })
} satisfies Meta<typeof NativeSelect>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Small: Story = { args: { size: 'sm' } };
export const Large: Story = { args: { size: 'lg' } };
export const Disabled: Story = { args: { disabled: true } };
export const Ghost: Story = { args: { variant: 'ghost' } };
