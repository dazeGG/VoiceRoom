import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import Button from '../Button/Button.vue';

import ParticipantTileFace from './ParticipantTileFace.vue';

const meta = {
  title: 'Components/Calls/ParticipantTileFace',
  component: ParticipantTileFace,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'The shared avatar, name and status content inside a participant tile.',
          '',
          '- Pass the participant name and initials, and provide `avatarSrc` when an image is available.',
          '- Set `local` to identify the current participant in the accessible heading. The visible heading shows the participant name.',
          '- Use `statusLabel` for the status line.',
          '- Use the `name` and `badge` slots to extend the heading. The surrounding tile controls the visibility of the muted and deafened marks.',
          '- Set `state` to `reconnecting` or `absent` for a placeholder without live media status or actions.'
        ].join('\n')
      }
    }
  },
  args: { name: 'Анна', initials: 'А', local: false },
  render: (args) => ({
    components: { ParticipantTileFace },
    setup: () => ({ args }),
    template: '<div class="participant" style="width: 360px"><ParticipantTileFace v-bind="args" /></div>'
  })
} satisfies Meta<typeof ParticipantTileFace>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Local: Story = { name: 'Current Participant', args: { local: true } };
export const WithStatus: Story = { args: { statusLabel: 'Слушает' } };
export const Speaking: Story = {
  args: { statusLabel: 'Говорит' },
  render: (args) => ({
    components: { ParticipantTileFace },
    setup: () => ({ args }),
    template:
      '<div class="participant participant--speaking" style="width: 360px"><ParticipantTileFace v-bind="args" /></div>'
  })
};
export const Muted: Story = {
  args: { statusLabel: 'Микрофон выключен' },
  render: (args) => ({
    components: { ParticipantTileFace },
    setup: () => ({ args }),
    template:
      '<div class="participant participant--muted" style="width: 360px"><ParticipantTileFace v-bind="args" /></div>'
  })
};
export const Deafened: Story = {
  args: { statusLabel: 'Звук выключен' },
  render: (args) => ({
    components: { ParticipantTileFace },
    setup: () => ({ args }),
    template:
      '<div class="participant participant--deafened" style="width: 360px"><ParticipantTileFace v-bind="args" /></div>'
  })
};
export const ImageFallback: Story = { args: { avatarSrc: './missing-avatar.png' } };
export const Reconnecting: Story = { args: { name: 'Аня', state: 'reconnecting' } };
export const Absent: Story = { args: { name: 'Аня', state: 'absent' } };
export const Reconnected: Story = {
  ...Reconnecting,
  render: (args) => ({
    components: { Button, ParticipantTileFace },
    setup: () => ({ args, connected: ref(false) }),
    template: `<div class="story-participant-tile">
      <div class="participant" :class="{ 'participant--speaking': connected }">
        <ParticipantTileFace v-bind="args" :state="connected ? 'connected' : 'reconnecting'" />
      </div>
      <Button @click="connected = !connected">{{ connected ? 'Подключаемся…' : 'В звонке' }}</Button>
    </div>`
  })
};
