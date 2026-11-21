import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import SegmentControl from './SegmentControl.vue';
import type { SegmentControlProps } from './types';

// Storybook's metadata type needs a concrete component option on the generic SFC.
const StorySegmentControl = Object.assign({ inheritAttrs: true }, SegmentControl<string>);

const meta = {
  title: 'Components/Inputs/SegmentControl',
  component: StorySegmentControl,
  tags: ['autodocs'],
  args: {
    ariaLabel: 'Режим микрофона',
    value: 'voice',
    options: [
      { value: 'voice', label: 'По голосу' },
      { value: 'key', label: 'По кнопке' }
    ]
  },
  render: (args: SegmentControlProps<string>) => ({
    components: { SegmentControl },
    setup: () => ({ args, value: ref(args.value) }),
    template: '<SegmentControl v-bind="args" :value="value" @change="value = $event" />'
  })
} satisfies Meta<typeof StorySegmentControl>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Medium: Story = { args: { ...meta.args, size: 'md' } };
export const Small: Story = {
  args: {
    ariaLabel: 'Качество',
    size: 'sm',
    value: '1080',
    options: [
      { value: '720', label: '720p' },
      { value: '1080', label: '1080p' },
      { value: '1440', label: '1440p', disabled: true }
    ]
  }
};
export const Tabs: Story = {
  args: {
    ariaLabel: 'Панель комнаты',
    kind: 'tabs',
    value: 'people',
    options: [
      { value: 'chat', label: 'Чат', dot: true },
      { value: 'people', label: 'Участники', count: 4 }
    ]
  }
};
