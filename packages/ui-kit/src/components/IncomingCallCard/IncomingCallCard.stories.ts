import type { Meta, StoryObj } from '@storybook/vue3-vite';
import IncomingCallCard from './IncomingCallCard.vue';

const meta = {
  title: 'Components/Calls/IncomingCallCard',
  component: IncomingCallCard,
  tags: ['autodocs'],
  args: { caller: { name: 'Аня', colorKey: 'rose' }, expiresAt: 0 },
  parameters: {
    docs: {
      description: {
        component:
          'A single non-modal incoming call. Pass the attempt expiry as a Unix timestamp in milliseconds. The host places cards, announces new attempts, and updates state in response to accept, decline and toggle-silence.'
      }
    }
  },
  render: (args) => ({
    components: { IncomingCallCard },
    setup: () => ({ args, expiresAt: Date.now() + 36_000 }),
    template: '<IncomingCallCard v-bind="args" :expires-at="args.expiresAt || expiresAt" />'
  })
} satisfies Meta<typeof IncomingCallCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const InRoom: Story = { args: { leaveRoomName: 'Вечерний созвон' } };
export const Silenced: Story = { args: { silenced: true } };
export const Accepting: Story = { args: { state: 'accepting' } };
export const Compact: Story = { args: { caller: { name: 'Лена', colorKey: 'amber' }, variant: 'compact' } };
export const CompactAccepting: Story = { args: { ...Compact.args, state: 'accepting' } };
export const Expired: Story = { args: { expiresAt: 1 } };
