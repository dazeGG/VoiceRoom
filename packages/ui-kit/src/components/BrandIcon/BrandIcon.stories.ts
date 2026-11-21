import type { Meta, StoryObj } from '@storybook/vue3-vite';
import BrandIcon from './BrandIcon.vue';

const meta = {
  title: 'Components/Structure/BrandIcon',
  component: BrandIcon,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'A decorative icon for a supported external brand.',
          '',
          '- Pass a brand icon definition and use `1x`, `sm` or `lg` to match the surrounding control.',
          '- Give the surrounding link or control an accessible name when the icon is its only visible content.'
        ].join('\n')
      }
    }
  },
  args: { icon: { icon: [24, 24, [], '0', 'M4 4h16v16H4z'] } },
  render: (args) => ({
    components: { BrandIcon },
    setup: () => ({ args }),
    template: '<BrandIcon v-bind="args" />'
  })
} satisfies Meta<typeof BrandIcon>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Small: Story = { args: { size: 'sm' } };
export const Large: Story = { args: { size: 'lg' } };
