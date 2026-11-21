import type { Meta, StoryObj } from '@storybook/vue3-vite';

import Button from './Button.vue';

const meta = {
  title: 'Components/Button',
  component: Button,
  tags: ['autodocs'],
  args: { variant: 'primary', size: 'md', disabled: false, type: 'button' },
  argTypes: {
    variant: { control: 'select', options: ['primary', 'ghost', 'outline', 'soft', 'danger', 'danger-ghost'] },
    size: { control: 'inline-radio', options: ['md', 'lg', 'xl'] }
  },
  render: (args) => ({
    components: { Button },
    setup: () => ({ args }),
    template: '<Button v-bind="args">Создать комнату</Button>'
  })
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};
export const Ghost: Story = { args: { variant: 'ghost' } };
export const Outline: Story = { args: { variant: 'outline' } };
export const Soft: Story = { args: { variant: 'soft' } };
export const Danger: Story = { args: { variant: 'danger' } };
export const DangerGhost: Story = { args: { variant: 'danger-ghost' } };
export const Large: Story = { args: { size: 'lg' } };
export const ExtraLarge: Story = { args: { size: 'xl' } };
export const Disabled: Story = { args: { disabled: true } };
export const Busy: Story = {
  args: { disabled: true },
  render: (args) => ({
    components: { Button },
    setup: () => ({ args }),
    template: '<Button v-bind="args" aria-busy="true">Создаём…</Button>'
  })
};
export const Join: Story = {
  render: (args) => ({
    components: { Button },
    setup: () => ({ args }),
    template: '<Button v-bind="args">Войти</Button>'
  })
};
