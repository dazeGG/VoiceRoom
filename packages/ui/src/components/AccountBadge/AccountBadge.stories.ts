import type { Meta, StoryObj } from '@storybook/vue3-vite';
import AccountBadge from './AccountBadge.vue';

const meta = {
  title: 'Components/People/AccountBadge',
  component: AccountBadge,
  tags: ['autodocs'],
  render: (args) => ({
    components: { AccountBadge },
    setup: () => ({ args }),
    template: '<p>VoiceRoom<AccountBadge v-bind="args" /></p>'
  })
} satisfies Meta<typeof AccountBadge>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Official: Story = { args: { badge: 'official' } };
export const Verified: Story = { args: { badge: 'verified', size: 18 } };
export const Absent: Story = {};
