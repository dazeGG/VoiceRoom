import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import StoryIcon from '../../../.storybook/StoryIcon.vue';

import Toggle from './Toggle.vue';
import type { ToggleProps } from './types';

const meta = {
  title: 'Components/Actions/Toggle',
  component: Toggle,
  tags: ['autodocs'],
  args: { size: 'sm', tone: 'default', pressed: false, disabled: false },
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'lg'] },
    tone: { control: 'inline-radio', options: ['default', 'good', 'bad'] }
  },
  render: (args: ToggleProps & { pressed?: boolean }) => ({
    components: { Toggle, StoryIcon },
    setup: () => ({ args, pressed: ref(args.pressed) }),
    template: '<Toggle v-bind="args" v-model:pressed="pressed"><StoryIcon name="bold" />Жирный</Toggle>'
  })
} satisfies Meta<typeof Toggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Small: Story = { args: { size: 'sm' } };
export const Large: Story = { args: { size: 'lg' } };
export const Pressed: Story = { args: { pressed: true } };
export const Disabled: Story = { args: { disabled: true } };
export const DisabledPressed: Story = { args: { pressed: true, disabled: true } };
export const Good: Story = {
  args: { tone: 'good', size: 'lg', pressed: true },
  render: (args: ToggleProps & { pressed?: boolean }) => ({
    components: { Toggle, StoryIcon },
    setup: () => ({ args, pressed: ref(args.pressed) }),
    template: '<Toggle v-bind="args" v-model:pressed="pressed"><StoryIcon name="thumbs-up" />Хорошо</Toggle>'
  })
};
export const Bad: Story = {
  args: { tone: 'bad', size: 'lg', pressed: true },
  render: (args: ToggleProps & { pressed?: boolean }) => ({
    components: { Toggle, StoryIcon },
    setup: () => ({ args, pressed: ref(args.pressed) }),
    template: '<Toggle v-bind="args" v-model:pressed="pressed"><StoryIcon name="thumbs-down" />Плохо</Toggle>'
  })
};
export const IconOnly: Story = {
  render: (args: ToggleProps & { pressed?: boolean }) => ({
    components: { Toggle, StoryIcon },
    setup: () => ({ args, pressed: ref(args.pressed) }),
    template: '<Toggle v-bind="args" v-model:pressed="pressed" aria-label="Жирный"><StoryIcon name="bold" /></Toggle>'
  })
};
export const TextOnly: Story = {
  render: (args: ToggleProps & { pressed?: boolean }) => ({
    components: { Toggle },
    setup: () => ({ args, pressed: ref(args.pressed) }),
    template: '<Toggle v-bind="args" v-model:pressed="pressed">Показывать друзей</Toggle>'
  })
};
