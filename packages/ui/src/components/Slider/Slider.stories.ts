import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';

import Slider from './Slider.vue';
import type { SliderProps } from './types';

const meta = {
  title: 'Components/Slider',
  component: Slider,
  tags: ['autodocs'],
  args: { min: 0, max: 100, step: 1, modelValue: 60, ariaLabel: 'Громкость', disabled: false },
  render: (args: SliderProps & { modelValue?: number }) => ({
    components: { Slider },
    setup: () => {
      const value = ref(args.modelValue ?? 0);
      return { args, value };
    },
    template: `
      <div style="width: 280px">
        <Slider v-bind="args" v-model="value" />
        <output aria-live="polite">Громкость: {{ value }}</output>
      </div>
    `
  })
} satisfies Meta<typeof Slider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const WithoutFill: Story = { args: { showFill: false } };
export const SnapToDefault: Story = {
  args: { defaultValue: 50, modelValue: 50, snap: true, snapThreshold: 8 }
};
export const Stepped: Story = { args: { step: 10 } };
