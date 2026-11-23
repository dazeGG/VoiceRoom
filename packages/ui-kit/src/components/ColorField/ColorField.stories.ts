import type { Meta, StoryObj } from '@storybook/vue3-vite';
import ColorField from './ColorField.vue';

const meta = {
  title: 'Components/Inputs/ColorField',
  component: ColorField,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'A labelled field that opens the platform colour picker.',
          '',
          '- Bind the selected colour with `v-model` and give the field an accessible name.',
          '- When the swatch sits beside a HEX or RGB field, use `secondary` and label the swatch separately so the main Field label still targets the text input.',
          '- Use `disabled` when the colour cannot change.'
        ].join('\n')
      }
    }
  },
  args: { modelValue: '#c1f100', label: 'Цвет акцента' }
} satisfies Meta<typeof ColorField>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true } };
