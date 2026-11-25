import type { Meta, StoryObj } from '@storybook/vue3-vite';
import Progress from './Progress.vue';

const meta = {
  title: 'Components/Feedback/Progress',
  component: Progress,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'Reka Progress bar with a label and a percent, or an indeterminate state.',
          '',
          '- Use a track of 4 or 8.',
          '- Put the label and the monospace percent above the bar.',
          '- On error, paint the bar `--vr-danger` and offer «Повторить» (Retry).',
          '- Use the indeterminate appearance when there is no percent.'
        ].join('\n')
      }
    }
  },
  args: { label: 'Загрузка изображения', value: 64 },
  argTypes: { value: { control: { type: 'range', min: 0, max: 100 } } }
} satisfies Meta<typeof Progress>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Large: Story = { args: { size: 'lg' } };
export const Complete: Story = { args: { value: 100 } };
export const Indeterminate: Story = { args: { label: 'Подключение к экрану', value: null } };
export const Error: Story = { args: { label: 'Не удалось загрузить изображение', error: true } };
export const HiddenLabel: Story = { args: { hideLabel: true } };
export const DecorativeTrack: Story = { args: { label: '', variant: 'track' } };
