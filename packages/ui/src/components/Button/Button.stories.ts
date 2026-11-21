import type { Meta, StoryObj } from '@storybook/vue3-vite';
import StoryIcon from '../../../.storybook/StoryIcon.vue';

import Button from './Button.vue';

const meta = {
  title: 'Components/Actions/Button',
  component: Button,
  tags: ['autodocs'],
  args: { variant: 'primary', size: 'md', disabled: false, busy: false, type: 'button' },
  argTypes: {
    variant: { control: 'select', options: ['primary', 'ghost', 'outline', 'plain', 'soft', 'danger', 'danger-ghost'] },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg', 'xl'] }
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
export const Plain: Story = { args: { variant: 'plain' } };
export const Soft: Story = { args: { variant: 'soft' } };
export const Danger: Story = { args: { variant: 'danger' } };
export const DangerGhost: Story = { args: { variant: 'danger-ghost' } };
export const Small: Story = { args: { size: 'sm' } };
export const Medium: Story = { args: { size: 'md' } };
export const Large: Story = { args: { size: 'lg' } };
export const ExtraLarge: Story = { args: { size: 'xl' } };
export const Disabled: Story = { args: { disabled: true } };
export const Busy: Story = {
  args: { busy: true },
  render: (args) => ({
    components: { Button },
    setup: () => ({ args }),
    template: '<Button v-bind="args">Создаём…</Button>'
  })
};
export const WithIcon: Story = {
  render: (args) => ({
    components: { Button, StoryIcon },
    setup: () => ({ args }),
    template: '<Button v-bind="args"><template #icon><StoryIcon name="plus" /></template>Создать комнату</Button>'
  })
};
export const Join: Story = {
  render: (args) => ({
    components: { Button },
    setup: () => ({ args }),
    template: '<Button v-bind="args">Войти</Button>'
  })
};

export const Inline: Story = { args: { variant: 'plain', size: 'inline' } };
export const Link: Story = { args: { variant: 'plain', href: '#rooms' } };
export const Scrim: Story = { args: { scrim: true, pill: true } };
export const Wrapping: Story = { args: { wrap: true, layout: 'spaced', fill: true } };
