import type { Meta, StoryObj } from '@storybook/vue3-vite';

import StoryIcon from '../../../.storybook/StoryIcon.vue';
import Badge from '../Badge/Badge.vue';
import IconButton from '../IconButton/IconButton.vue';
import ListItem from './ListItem.vue';

const meta = {
  title: 'Components/People/ListItem',
  component: ListItem,
  tags: ['autodocs'],
  args: {
    text: 'Аня',
    caption: 'В комнате «Пятничные игры»',
    avatar: { name: 'Аня', colorKey: 'blurple', showDot: true, online: true },
    interactive: true
  }
} satisfies Meta<typeof ListItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithTime: Story = { args: { time: 'вчера' } };
export const Dense: Story = { args: { dense: true, caption: '' } };
export const Static: Story = { args: { interactive: false } };
export const Disabled: Story = { args: { disabled: true } };
export const WithBadgeAndActions: Story = {
  render: (args) => ({
    components: { Badge, IconButton, ListItem, StoryIcon },
    setup: () => ({ args }),
    template: `
      <ListItem v-bind="args">
        <template #meta><Badge :count="2" /></template>
        <template #actions>
          <IconButton :size="28" label="Написать"><StoryIcon name="reply" /></IconButton>
          <IconButton :size="28" label="Ещё"><StoryIcon name="ellipsis" /></IconButton>
        </template>
      </ListItem>
    `
  })
};
