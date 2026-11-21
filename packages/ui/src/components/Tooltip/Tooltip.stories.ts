import type { Meta, StoryObj } from '@storybook/vue3-vite';

import Button from '../Button/Button.vue';
import Tooltip from './Tooltip.vue';

const meta = {
  title: 'Components/Feedback/Tooltip',
  component: Tooltip,
  tags: ['autodocs'],
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
