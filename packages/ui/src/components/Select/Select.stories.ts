import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import Select from './Select.vue';

const meta = {
  title: 'Components/Select',
  component: Select,
  tags: ['autodocs'],
  args: {
    label: 'Микрофон',
    options: [
      { value: '', label: 'По умолчанию' },
      { value: 'headset', label: 'Микрофон гарнитуры' },
      { value: 'studio', label: 'Студийный микрофон' }
    ],
    variant: 'field',
    placement: 'bottom-start',
    flip: true
  },
  render: (args) => ({
    components: { Select },
    setup() {
      const value = ref('');
      return { args, value };
    },
    template: '<Select v-bind="args" v-model="value" />'
  })
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Field: Story = {};
export const Home: Story = { args: { variant: 'home' } };
export const Compact: Story = { args: { variant: 'compact' } };
export const Dock: Story = { args: { variant: 'dock' } };
export const Disabled: Story = { args: { disabled: true } };
export const Empty: Story = { args: { options: [] } };
export const BottomEnd: Story = { args: { placement: 'bottom-end' } };
export const TopStart: Story = { args: { placement: 'top-start' } };
export const TopEnd: Story = { args: { placement: 'top-end' } };
