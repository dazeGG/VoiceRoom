import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { fireEvent } from 'storybook/test';
import FileDrop from './FileDrop.vue';

const meta = {
  title: 'Components/Inputs/FileDrop',
  component: FileDrop,
  tags: ['autodocs'],
  args: { accept: 'image/*,video/*', multiple: true, caption: 'Изображения и видео до 50 МБ' }
} satisfies Meta<typeof FileDrop>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Dropzone: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const Dragging: Story = {
  play: async ({ canvasElement }) => {
    const zone = canvasElement.querySelector('.ui-dropzone');
    if (!zone) return;
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(['avatar'], 'avatar.png', { type: 'image/png' }));
    await fireEvent.dragEnter(zone, { dataTransfer });
  }
};
export const Avatar: Story = {
  args: {
    variant: 'avatar',
    accept: 'image/png,image/jpeg',
    multiple: false,
    caption: 'PNG или JPG, минимум 256×256',
    avatar: { name: 'Лобби', shape: 'squircle' }
  }
};
