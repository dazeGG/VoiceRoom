import type { Meta, StoryObj } from '@storybook/vue3-vite';

import Spinner from './Spinner.vue';

const meta = {
  title: 'Components/Feedback/Spinner',
  component: Spinner,
  tags: ['autodocs'],
  args: { size: 16 },
  argTypes: { size: { control: 'inline-radio', options: [12, 16, 20, 24] } }
} satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Size12: Story = { args: { size: 12 } };
export const Size16: Story = {};
export const Size20: Story = { args: { size: 20 } };
export const Size24: Story = { args: { size: 24 } };
export const WithLabel: Story = {
  args: { label: 'Подключение к серверу' },
  render: (args) => ({
    components: { Spinner },
    setup: () => ({ args }),
    template:
      '<span style="display: inline-flex; align-items: center; gap: var(--space-8)"><Spinner v-bind="args" />Подключение к серверу</span>'
  })
};
