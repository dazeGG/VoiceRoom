import type { Meta, StoryObj } from '@storybook/vue3-vite';
import CallEventRow from './CallEventRow.vue';

const meta = {
  title: 'Components/Calls/CallEventRow',
  component: CallEventRow,
  tags: ['autodocs'],
  args: { kind: 'outgoing', time: '21:40', durationMs: 12 * 60_000 },
  parameters: {
    docs: {
      description: {
        component:
          'A call event for a direct-message stream. Pass the kind and direction relative to the viewer. The finished duration measures time spent connected together. For live calls, pass the start of the stage timer and the current joined state.'
      }
    }
  },
  render: (args) => ({
    components: { CallEventRow },
    setup: () => ({ args, startedAt: Date.now() - 271_000 }),
    template: '<CallEventRow v-bind="args" :started-at="args.startedAt ?? startedAt" />'
  })
} satisfies Meta<typeof CallEventRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Outgoing: Story = {};
export const Incoming: Story = { args: { kind: 'incoming', time: '23:05', durationMs: 3 * 60_000 } };
export const Missed: Story = { args: { kind: 'missed', time: '09:12' } };
export const NoAnswer: Story = { args: { kind: 'no-answer', time: '09:30' } };
export const DeclinedIncoming: Story = { args: { kind: 'declined', direction: 'incoming', time: '10:02' } };
export const DeclinedOutgoing: Story = { args: { kind: 'declined', direction: 'outgoing', time: '10:02' } };
export const LiveJoin: Story = { args: { kind: 'live', peerName: 'Аня' } };
export const LiveReturn: Story = { args: { kind: 'live', joined: true } };
export const SubMinute: Story = { args: { durationMs: 59_000 } };
export const OverAnHour: Story = { args: { durationMs: 65 * 60_000 } };
