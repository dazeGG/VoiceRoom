import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';

import Slider from './Slider.vue';
import type { SliderProps } from './types';

const meta = {
  title: 'Components/Inputs/Slider',
  component: Slider,
  tags: ['autodocs'],
  args: { min: 0, max: 100, modelValue: 60, ariaLabel: 'Громкость', disabled: false },
  render: (args: SliderProps & { modelValue?: number }) => ({
    components: { Slider },
    setup: () => {
      const value = ref(args.modelValue ?? 0);
      return { args, value };
    },
    template: `
      <div style="min-width: calc(var(--space-64) * 4)">
        <div style="display: flex; justify-content: space-between">
          <span>{{ args.ariaLabel }}</span>
          <output style="font-family: var(--font-mono)">{{ value }}%</output>
        </div>
        <Slider v-bind="args" v-model="value" />
      </div>
    `
  })
} satisfies Meta<typeof Slider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const LiveLevel: Story = {
  args: { showFill: false, ariaLabel: 'Порог шумового гейта' },
  render: (args: SliderProps & { modelValue?: number }) => ({
    components: { Slider },
    setup: () => ({ args, value: ref(args.modelValue ?? 0) }),
    template: `<div style="min-width: calc(var(--space-64) * 4)">
      <Slider v-bind="args" v-model="value">
        <template #background>
          <span style="display: block; width: 70%; height: 100%; border-radius: inherit; background: var(--vr-success)"></span>
        </template>
      </Slider>
    </div>`
  })
};
export const SnapToDefault: Story = {
  args: { defaultValue: 50, modelValue: 50, snap: true, snapThreshold: 8 }
};
export const Stepped: Story = { args: { step: 10 } };
