import type { Meta, StoryObj } from '@storybook/vue3-vite';
import Pressable from './Pressable.vue';

const meta = {
  title: 'Components/Actions/Pressable',
  component: Pressable,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'A keyboard-operable surface for a tile, row or preview with its own shape.',
          '',
          '- Use the default button for an action and give it a visible or accessible label.',
          '- Use `as-child` with a single link to keep its link semantics. A disabled child is removed from the tab order and its click is blocked.',
          '- Set `display` to fit the layout, `inset` for an inset focus ring and `hoverable` for a hover background.'
        ].join('\n')
      }
    }
  },
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
