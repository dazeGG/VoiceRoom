import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import Toolbar from './Toolbar.vue';
import StoryIcon from '../../../.storybook/StoryIcon.vue';
import ToolbarToggle from './ToolbarToggle.vue';

const meta = {
  title: 'Components/Structure/ToolbarToggle',
  component: ToolbarToggle,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'A persistent pressed action inside a toolbar.',
          '',
          '- Bind the pressed state with `v-model` and provide a label and icon.',
          '- Add a shortcut when available and use `disabled` for an unavailable toggle.'
        ].join('\n')
      }
    }
  },
  args: { label: 'Полужирный', shortcut: ['Ctrl', 'B'] },
  render: (args) => ({
    components: { ToolbarToggle, Toolbar, StoryIcon },
    setup: () => ({ args, pressed: ref(false) }),
    template: `<Toolbar label="Форматирование"><ToolbarToggle v-bind="args" v-model:pressed="pressed"><StoryIcon name="bold" /></ToolbarToggle></Toolbar>`
  })
} satisfies Meta<typeof ToolbarToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true } };
