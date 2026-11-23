import type { Meta, StoryObj } from '@storybook/vue3-vite';

import Button from '../Button/Button.vue';
import Tooltip from './Tooltip.vue';

const meta = {
  title: 'Components/Feedback/Tooltip',
  component: Tooltip,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'Reka Tooltip that repeats an aria-label and adds no new information.',
          '',
          '- Use a height from 28, text 12/500, radius 8, and a single line up to 240px.',
          '- Show it after 400 ms of hover, or immediately on focus. Hide it with Esc.',
          '- Repeat `aria-label`. Do not put new information in it.',
          '- Put a shortcut in a Kbd on the right.'
        ].join('\n')
      }
    }
  },
  args: { text: 'Выключить микрофон', side: 'top' },
  argTypes: { side: { control: 'inline-radio', options: ['top', 'right', 'bottom', 'left'] } },
  render: (args) => ({
    components: { Tooltip, Button },
    setup: () => ({ args }),
    template: '<div style="padding: var(--space-48)"><Tooltip v-bind="args"><Button>Микрофон</Button></Tooltip></div>'
  })
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Top: Story = {};
export const Right: Story = { args: { side: 'right' } };
export const Bottom: Story = { args: { side: 'bottom' } };
export const Left: Story = { args: { side: 'left' } };
export const WithShortcut: Story = { args: { shortcut: ['Ctrl', 'M'] } };
export const LongText: Story = { args: { text: 'Скопировать ссылку на голосовую комнату' } };
