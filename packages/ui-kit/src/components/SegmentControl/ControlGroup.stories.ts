import type { Meta, StoryObj } from '@storybook/vue3-vite';
import ControlGroup from './ControlGroup.vue';

const meta = {
  title: 'Components/Structure/ControlGroup',
  component: ControlGroup,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'A labelled track for adjacent controls that keep their own interaction semantics.',
          '',
          '- Set `label` to name the group and place the controls in the default slot.',
          '- Use it to group related controls such as an action and its menu trigger. Use SegmentControl for a single choice among options.'
        ].join('\n')
      }
    }
  },
  args: { label: 'Разделы комнаты' },
  render: (args) => ({
    components: { ControlGroup },
    setup: () => ({ args }),
    template: '<ControlGroup v-bind="args"><span>Чат</span><span>Участники</span></ControlGroup>'
  })
} satisfies Meta<typeof ControlGroup>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
