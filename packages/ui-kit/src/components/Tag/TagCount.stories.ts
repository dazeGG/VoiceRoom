import type { Meta, StoryObj } from '@storybook/vue3-vite';
import Tag from './Tag.vue';
import TagCount from './TagCount.vue';

const meta = {
  title: 'Components/Feedback/TagCount',
  component: TagCount,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'An accessible action for the count beside a reaction.',
          '',
          '- Place TagCount in the Tag `count` slot to keep the count and the reaction toggle independently operable.',
          '- Pass the numeric `count` and a `label` describing the action, such as opening the list of people who reacted.'
        ].join('\n')
      }
    }
  },
  args: { count: 4, label: 'Показать пользователей: 4' },
  render: (args) => ({
    components: { TagCount, Tag },
    setup: () => ({ args }),
    template: `<Tag variant="reaction" emoji="👍"><template #count><TagCount v-bind="args" /></template></Tag>`
  })
} satisfies Meta<typeof TagCount>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
