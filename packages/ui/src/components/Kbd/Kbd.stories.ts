import type { Meta, StoryObj } from '@storybook/vue3-vite';

import Kbd from './Kbd.vue';

const meta = {
  title: 'Components/Feedback/Kbd',
  component: Kbd,
  tags: ['autodocs'],
  args: { keys: ['Ctrl', 'M'] }
} satisfies Meta<typeof Kbd>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Shortcut: Story = {};
export const SingleKey: Story = { args: { keys: ['Esc'] } };
export const ThreeKeys: Story = { args: { keys: ['Ctrl', 'Shift', 'D'] } };
export const FunctionKey: Story = { args: { keys: ['F8'] } };
