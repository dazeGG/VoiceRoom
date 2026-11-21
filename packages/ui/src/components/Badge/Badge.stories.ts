import type { Meta, StoryObj } from '@storybook/vue3-vite';
import Badge from './Badge.vue';

const meta = {
  title: 'Components/Feedback/Badge',
  component: Badge,
  tags: ['autodocs'],
  args: { count: 12, size: 'md', tone: 'accent', variant: 'pill' }
} satisfies Meta<typeof Badge>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Accent: Story = {};
export const Muted: Story = { args: { tone: 'muted', count: 4 } };
export const Danger: Story = { args: { tone: 'danger', count: 2 } };
export const Overflow: Story = { args: { count: 135 } };
export const SmallWithRing: Story = { args: { size: 'sm', ring: true, count: 3 } };
export const Dot: Story = { args: { variant: 'dot' } };
export const Words: Story = {
  render: () => ({
    components: { Badge },
    template: '<Badge tone="soft">Бета</Badge> <Badge tone="warning">Скоро</Badge>'
  })
};
