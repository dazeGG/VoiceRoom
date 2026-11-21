import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { fireEvent } from 'storybook/test';
import Button from '../Button/Button.vue';
import FileDrop from './FileDrop.vue';

const meta = {
  title: 'Components/Inputs/FileDrop',
  component: FileDrop,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'Own drop zone with an `<input type="file">` inside.',
          '',
          '- Make the zone at least 160. For an avatar field, use an avatar of 56 and sm buttons.',
          '- While dragging, use a `--vr-accent` border and `--vr-accent-soft`.',
          '- Offer a «Выбрать файл» (Choose file) button that does the same thing as dropping.',
          '- Put limits in a caption under the title, and show an error as a toast or a danger Callout.'
        ].join('\n')
      }
    }
  },
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

export const Trigger: Story = {
  args: { variant: 'trigger', inputLabel: 'Изображение' },
  render: (args) => ({
    components: { FileDrop, Button },
    setup: () => ({ args }),
    template:
      '<FileDrop v-slot="{ choose }" v-bind="args"><Button @click="choose">Выбрать изображение</Button></FileDrop>'
  })
};
