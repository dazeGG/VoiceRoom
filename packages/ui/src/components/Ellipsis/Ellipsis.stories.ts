import type { Meta, StoryObj } from '@storybook/vue3-vite';
import Ellipsis from './Ellipsis.vue';

const meta = {
  title: 'Components/Structure/Ellipsis',
  component: Ellipsis,
  tags: ['autodocs'],
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
