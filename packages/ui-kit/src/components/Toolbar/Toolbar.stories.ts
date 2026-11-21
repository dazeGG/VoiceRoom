import type { Meta, StoryObj } from '@storybook/vue3-vite';
import StoryIcon from '../../../.storybook/StoryIcon.vue';
import Separator from '../Separator/Separator.vue';
import Toolbar from './Toolbar.vue';
import ToolbarButton from './ToolbarButton.vue';
import ToolbarToggle from './ToolbarToggle.vue';

const meta = {
  title: 'Components/Structure/Toolbar',
  component: Toolbar,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'Reka Toolbar of icon buttons, with Toggle for formatting.',
          '',
          '- Build it on Reka Toolbar, and use Toggle for formatting.',
          '- Use padding 4, buttons of 32 (radius 8), a panel radius of 12, `--vr-surface-2`, a `--vr-line-strong` border and a `--vr-shadow-popover` shadow.',
          '- Separate groups with a vertical Separator of 20.',
          '- Give every button a Tooltip that includes its shortcut.'
        ].join('\n')
      }
    }
  },
  args: { label: 'Форматирование сообщения' },
  render: (args) => ({
    components: { Toolbar, ToolbarButton, ToolbarToggle, Separator, StoryIcon },
    setup: () => ({ args }),
    template: `
      <Toolbar v-bind="args">
        <ToolbarToggle label="Жирный" :shortcut="['Ctrl', 'B']" pressed><StoryIcon name="bold" /></ToolbarToggle>
        <ToolbarToggle label="Курсив" :shortcut="['Ctrl', 'I']"><StoryIcon name="italic" /></ToolbarToggle>
        <Separator orientation="vertical" />
        <ToolbarButton label="Отменить" :shortcut="['Ctrl', 'Z']" disabled><StoryIcon name="undo-2" /></ToolbarButton>
      </Toolbar>`
  })
} satisfies Meta<typeof Toolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Formatting: Story = {};

export const Bare: Story = { args: { variant: 'bare' } };
