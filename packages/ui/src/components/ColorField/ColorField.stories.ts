import type { Meta, StoryObj } from '@storybook/vue3-vite';
import ColorField from './ColorField.vue';

const meta = {
  title: 'Components/Inputs/ColorField',
  component: ColorField,
  tags: ['autodocs'],
  args: { modelValue: '#c1f100', label: 'Цвет акцента' }
} satisfies Meta<typeof ColorField>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true } };
