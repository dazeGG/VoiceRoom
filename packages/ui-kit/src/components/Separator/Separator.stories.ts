import type { Meta, StoryObj } from '@storybook/vue3-vite';
import Separator from './Separator.vue';

const meta = {
  title: 'Components/Structure/Separator',
  component: Separator,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'Reka Separator, silent when it is only decorative.',
          '',
          '- Use 1px `--vr-line` horizontally, and 20px `--vr-line-strong` vertically.',
          '- Do not announce a decorative separator.',
          '- In a menu, extend it to the edges of the panel.'
        ].join('\n')
      }
    }
  },
  render: (args) => ({
    components: { Separator },
    setup: () => ({ args }),
    template: `
      <div v-if="args.orientation === 'vertical'" style="display: flex; align-items: center">
        <span>Вход</span><Separator v-bind="args" /><span>Выход</span>
      </div>
      <div v-else>
        <p>Аккаунт</p><Separator v-bind="args" /><p>Приложение</p>
      </div>`
  })
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {};
export const Vertical: Story = { args: { orientation: 'vertical' } };
export const Decorative: Story = { args: { decorative: true } };

export const ResizeHandle: Story = { args: { variant: 'resize', orientation: 'vertical' } };
