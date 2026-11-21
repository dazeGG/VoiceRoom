import type { Meta, StoryObj } from '@storybook/vue3-vite';
import Pressable from './Pressable.vue';

const meta = {
  title: 'Components/Actions/Pressable',
  component: Pressable,
  tags: ['autodocs'],
  render: (args) => ({
    components: { Pressable },
    setup: () => ({ args }),
    template: '<Pressable v-bind="args">Открыть комнату</Pressable>'
  })
} satisfies Meta<typeof Pressable>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Hoverable: Story = { args: { hoverable: true, inset: true, display: 'flex' } };
export const Disabled: Story = { args: { disabled: true } };
export const Link: Story = {
  render: () => ({
    components: { Pressable },
    template: '<Pressable as-child><a href="#rooms">Комнаты</a></Pressable>'
  })
};
