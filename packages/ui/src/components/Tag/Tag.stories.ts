import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import Tag from './Tag.vue';
import type { TagProps } from './types';

const meta = {
  title: 'Components/Feedback/Tag',
  component: Tag,
  tags: ['autodocs'],
  render: (args: TagProps & { pressed?: boolean }) => ({
    components: { Tag },
    setup: () => ({ args, pressed: ref(args.pressed), visible: ref(true) }),
    template:
      '<Tag v-if="visible" v-bind="args" v-model:pressed="pressed" @remove="visible = false">{{ args.variant === "reaction" ? "" : "Чистый звук" }}</Tag>'
  })
} satisfies Meta<typeof Tag>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Static: Story = {};
export const Selectable: Story = { args: { selectable: true } };
export const Selected: Story = { args: { selectable: true, pressed: true } };
export const Disabled: Story = { args: { selectable: true, disabled: true } };
export const Removable: Story = { args: { removable: true } };
export const Reaction: Story = {
  args: { size: 'sm', variant: 'reaction', emoji: '🔥', count: 3, selectable: true, label: 'Реакция 🔥' }
};
export const OwnReaction: Story = { args: { ...Reaction.args, pressed: true } };
