import type { Meta, StoryObj } from '@storybook/vue3-vite';

import Kbd from './Kbd.vue';

const meta = {
  title: 'Components/Feedback/Kbd',
  component: Kbd,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'Own `<kbd>` for one key, or plain monospace text inside a menu.',
          '',
          '- Use a height of 20.',
          '- Put each key in its own `<kbd>`, with no «+».',
          '- Name keys as they are printed on the keyboard: Ctrl, Shift, Alt, ⌘.',
          '- In menu rows, use monospace text with no frame.'
        ].join('\n')
      }
    }
  },
  args: { keys: ['Ctrl', 'M'] }
} satisfies Meta<typeof Kbd>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Shortcut: Story = {};
export const SingleKey: Story = { args: { keys: ['Esc'] } };
export const ThreeKeys: Story = { args: { keys: ['Ctrl', 'Shift', 'D'] } };
export const FunctionKey: Story = { args: { keys: ['F8'] } };
