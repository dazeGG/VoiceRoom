import type { Meta, StoryObj } from '@storybook/vue3-vite';
import '../../styles/widget/_shell.scss';
import WidgetCallLayout from './WidgetCallLayout.vue';

const meta = {
  title: 'Apps/Widget/Call',
  component: WidgetCallLayout,
  tags: ['autodocs'],
  args: {
    roomCode: 'ABCD',
    status: 'В комнате',
    quality: 'good',
    preview: true,
    members: [
      { id: 'self', name: 'Анна', self: true },
      { id: 'speaking', name: 'Олег', speaking: true },
      { id: 'muted', name: 'Мира', muted: true }
    ]
  },
  render: (args) => ({
    components: { WidgetCallLayout },
    setup: () => ({ args }),
    template: `
      <div class="widget-shell widget-shell--call widget-shell--preview story-widget">
        <div class="widget-shell__body"><WidgetCallLayout v-bind="args" /></div>
      </div>
    `
  })
} satisfies Meta<typeof WidgetCallLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Call: Story = {};
