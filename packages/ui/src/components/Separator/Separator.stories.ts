import type { Meta, StoryObj } from '@storybook/vue3-vite';
import Separator from './Separator.vue';

const meta = {
  title: 'Components/Structure/Separator',
  component: Separator,
  tags: ['autodocs'],
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
