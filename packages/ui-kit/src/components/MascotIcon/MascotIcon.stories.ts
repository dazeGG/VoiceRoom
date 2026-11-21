import type { Meta, StoryObj } from '@storybook/vue3-vite';
import MascotIcon from './MascotIcon.vue';

const meta = {
  title: 'Components/Feedback/MascotIcon',
  component: MascotIcon,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'The standalone VoiceRoom mascot for a dark surface.',
          '',
          '- Use the original colour and choose `blink`, `look` or `scare` for the expression.',
          '- Set `size` for the available space and keep any surrounding action independently labelled.'
        ].join('\n')
      }
    }
  },
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
