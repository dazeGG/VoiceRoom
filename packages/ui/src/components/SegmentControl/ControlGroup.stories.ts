import type { Meta, StoryObj } from '@storybook/vue3-vite';
import ControlGroup from './ControlGroup.vue';

const meta = {
  title: 'Components/Structure/ControlGroup',
  component: ControlGroup,
  tags: ['autodocs'],
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
