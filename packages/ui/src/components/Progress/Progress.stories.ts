import type { Meta, StoryObj } from '@storybook/vue3-vite';
import Progress from './Progress.vue';

const meta = {
  title: 'Components/Feedback/Progress',
  component: Progress,
  tags: ['autodocs'],
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
