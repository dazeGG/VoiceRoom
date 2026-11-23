import type { Meta, StoryObj } from '@storybook/vue3-vite';
import StoryIcon from '../../../.storybook/StoryIcon.vue';
import Button from '../Button/Button.vue';
import EmptyState from './EmptyState.vue';

const meta = {
  title: 'Components/Feedback/EmptyState',
  component: EmptyState,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'Own empty state whose button is the action the text describes.',
          '',
          '- Use an icon of 24 inside a circle of 48.',
          '- Write the title as a calm fact, the text as what to do, and the button as that action.',
          '- In a narrow panel, omit the button and use padding 24 instead of 32.'
        ].join('\n')
      }
    }
  },
  args: { title: 'Новых уведомлений нет', text: 'Здесь появятся заявки в друзья, приглашения и упоминания.' }
} satisfies Meta<typeof EmptyState>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Compact: Story = { args: { compact: true } };
export const WithAction: Story = {
  args: { title: 'Пока нет друзей', text: 'Откройте «Заявки», чтобы добавить друга по логину.' },
  render: (args) => ({
    components: { Button, EmptyState, StoryIcon },
    setup: () => ({ args }),
    template:
      '<EmptyState v-bind="args"><template #icon><StoryIcon name="user-plus" /></template><template #action><Button size="sm">Добавить друга</Button></template></EmptyState>'
  })
};
