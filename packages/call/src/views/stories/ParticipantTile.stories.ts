import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ParticipantTile } from '..';
import { markRaw } from 'vue';

const participant = {
  id: 'story-peer',
  name: 'Анна',
  isLocal: false,
  deafened: false,
  muted: false,
  screen: false,
  speaking: false,
  cameraStream: null,
  statusLabel: ''
};

const meta = {
  title: 'Components/Call/ParticipantTile',
  component: ParticipantTile,
  tags: ['autodocs'],
  args: {
    participant,
    avatar: {
      src: null,
      initials: 'А',
      background: 'var(--avatar-blurple-bg)',
      foreground: 'var(--avatar-blurple-ink)'
    },
    viewing: false,
    mirrored: false,
    screenRequesting: false
  },
  render: (args) => ({
    components: { ParticipantTile },
    setup: () => ({ args }),
    template: '<div class="story-participant-tile"><ParticipantTile v-bind="args" /></div>'
  })
} satisfies Meta<typeof ParticipantTile>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {};
export const Speaking: Story = { args: { participant: { ...participant, speaking: true } } };
export const Muted: Story = { args: { participant: { ...participant, muted: true, deafened: true } } };
export const Sharing: Story = {
  args: { participant: { ...participant, screen: true, statusLabel: 'Показывает экран' } }
};
export const WithVideo: Story = {
  render: (args) => ({
    components: { ParticipantTile },
    setup: () => ({ args, placeholder: markRaw(new MediaStream()) }),
    template: `<div class="story-participant-tile">
      <ParticipantTile v-bind="args" :participant="{ ...args.participant, cameraStream: placeholder }" />
    </div>`
  })
};
export const Sizes: Story = {
  render: (args) => ({
    components: { ParticipantTile },
    setup: () => ({ args }),
    template: `<div class="story-participant-tile__sizes">
      <div class="story-participant-tile story-participant-tile--small"><ParticipantTile v-bind="args" /></div>
      <div class="story-participant-tile"><ParticipantTile v-bind="args" /></div>
      <div class="story-participant-tile story-participant-tile--large"><ParticipantTile v-bind="args" /></div>
    </div>`
  })
};
