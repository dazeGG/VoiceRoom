import type { Meta, StoryObj } from '@storybook/vue3-vite';
import Ellipsis from './Ellipsis.vue';

const meta = {
  title: 'Components/Structure/Ellipsis',
  component: Ellipsis,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'A single-line text wrapper that reveals the full value on hover.',
          '',
          '- Give the surrounding container a width constraint so long text can truncate.',
          '- Use `text` for a plain value or the default slot for custom content. Supply `title` when the slot content needs a hover label.',
          '- Use `inline` for text in a running line and `tag` for the appropriate HTML element.'
        ].join('\n')
      }
    }
  },
  args: { text: 'Название комнаты, которое не помещается в строку' },
  render: (args) => ({
    components: { Ellipsis },
    setup: () => ({ args }),
    template: '<div style="max-inline-size: 12rem"><Ellipsis v-bind="args" /></div>'
  })
} satisfies Meta<typeof Ellipsis>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Inline: Story = { args: { inline: true } };
