import type { Meta, StoryObj } from '@storybook/vue3-vite';
import Toolbar from './Toolbar.vue';
import StoryIcon from '../../../.storybook/StoryIcon.vue';
import ToolbarButton from './ToolbarButton.vue';

const meta = {
  title: 'Components/Structure/ToolbarButton',
  component: ToolbarButton,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'A momentary icon action that participates in toolbar keyboard navigation.',
          '',
          '- Supply a `label` and icon. Pass a keyboard shortcut when the host supports it.',
          '- Use `disabled` for an unavailable action and put the button inside Toolbar.'
        ].join('\n')
      }
    }
  },
  args: { label: 'Скопировать', shortcut: ['Ctrl', 'C'] },
  render: (args) => ({
    components: { ToolbarButton, Toolbar, StoryIcon },
    setup: () => ({ args }),
    template: `<Toolbar label="Действия"><ToolbarButton v-bind="args"><StoryIcon name="copy" /></ToolbarButton></Toolbar>`
  })
} satisfies Meta<typeof ToolbarButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true } };
