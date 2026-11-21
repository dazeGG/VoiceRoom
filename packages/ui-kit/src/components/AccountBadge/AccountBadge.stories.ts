import type { Meta, StoryObj } from '@storybook/vue3-vite';
import AccountBadge from './AccountBadge.vue';

const meta = {
  title: 'Components/People/AccountBadge',
  component: AccountBadge,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'A mark that identifies an official or verified VoiceRoom account.',
          '',
          '- Set `badge` to `official` or `verified` so the accessible name matches the account status.',
          '- Use size 16 in compact rows or 18 alongside larger account names. Omit the badge when the account has no status.'
        ].join('\n')
      }
    }
  },
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
