import type { Meta, StoryObj } from '@storybook/vue3-vite';

import ParticipantTileFace from './ParticipantTileFace.vue';

const meta = {
  title: 'Components/ParticipantTileFace',
  component: ParticipantTileFace,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'The shared avatar, name and status content inside a participant tile.',
          '',
          '- Pass the participant name and initials, and provide `avatarSrc` when an image is available.',
          '- Mark the current participant with `local` and use `statusLabel` for the status line.',
          '- Use the `name` and `badge` slots to extend the heading. The surrounding tile controls the visibility of the muted and deafened marks.'
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
export const Local: Story = { args: { local: true } };
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
