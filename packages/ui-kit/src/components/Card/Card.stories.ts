import type { Meta, StoryObj } from '@storybook/vue3-vite';
import Card from './Card.vue';

const meta = {
  title: 'Components/Structure/Card',
  component: Card,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'Own surface for grouped content that is not nested inside another card.',
          '',
          '- Use radius 16 and padding 16.',
          '- Do not nest a card inside a card. Separate the contents with `--vr-line`.'
        ].join('\n')
      }
    }
  },
  args: { as: 'article' },
  render: (args) => ({
    components: { Card },
    setup: () => ({ args }),
    template: `<Card v-bind="args"><p>Сводка по комнате</p></Card>`
  })
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Plain: Story = { args: { as: 'div' } };
export const Section: Story = { args: { as: 'section' } };
