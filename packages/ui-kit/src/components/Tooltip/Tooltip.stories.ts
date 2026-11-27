import type { Meta, StoryObj } from '@storybook/vue3-vite';

import Button from '../Button/Button.vue';
import IconButton from '../IconButton/IconButton.vue';
import StoryIcon from '../../../.storybook/StoryIcon.vue';
import Tooltip from './Tooltip.vue';

const meta = {
  title: 'Components/Feedback/Tooltip',
  component: Tooltip,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'Reka Tooltip with a label and optional supporting description.',
          '',
          '- Use a height from 28, text 12/500, radius 8, and a single line up to 240px.',
          '- Show it after 400 ms of hover, or immediately on focus. Hide it with Esc.',
          '- A description wraps below the label. IconButton also includes it in its accessible label so it is available before the tooltip opens.',
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
export const Offline: Story = {
  args: { text: 'Позвонить', description: 'Не в сети. Звонок придёт уведомлением' },
  render: (args) => ({
    components: { IconButton, StoryIcon },
    setup: () => ({ args }),
    template: `<div style="padding: var(--space-48)">
      <IconButton :label="args.text" :tooltip-description="args.description"><StoryIcon name="phone" /></IconButton>
    </div>`
  })
};
export const LeaveRoom: Story = {
  ...Offline,
  args: { text: 'Позвонить', description: 'Вы покинете «Вечерний созвон»' }
};
export const LongDescription: Story = {
  ...Offline,
  args: { text: 'Позвонить', description: 'Вы покинете «Вечерний созвон с друзьями и длинным названием»' }
};
