import type { Meta, StoryObj } from '@storybook/vue3-vite';
import MascotIcon from './MascotIcon.vue';

const meta = {
  title: 'Components/Feedback/MascotIcon',
  component: MascotIcon,
  tags: ['autodocs'],
  render: (args) => ({
    components: { MascotIcon },
    setup: () => ({ args }),
    template: '<MascotIcon v-bind="args" />'
  })
} satisfies Meta<typeof MascotIcon>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Blink: Story = { args: { variant: 'blink' } };
export const Look: Story = { args: { variant: 'look' } };
export const Scare: Story = { args: { variant: 'scare' } };
